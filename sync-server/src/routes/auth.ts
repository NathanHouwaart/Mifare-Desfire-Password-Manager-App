import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import {
  hashPassword,
  hashRefreshToken,
  issueTokenPair,
  verifyPassword,
  verifyRefreshToken,
} from '../auth.js';

interface AuthRouteDeps {
  pool: Pool;
  config: AppConfig;
}

const credentialsSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(10).max(256),
  deviceName: z.string().min(1).max(120).default('desktop'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

async function createDevice(client: PoolClient, userId: string, deviceName: string): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO devices (user_id, name) VALUES ($1, $2) RETURNING id`,
    [userId, deviceName]
  );
  return inserted.rows[0].id;
}

async function persistRefreshToken(
  client: PoolClient,
  userId: string,
  deviceId: string,
  refreshToken: string,
  expiresAt: Date
): Promise<void> {
  await client.query(
    `INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, deviceId, hashRefreshToken(refreshToken), expiresAt.toISOString()]
  );
}

export function registerAuthRoutes({ pool, config }: AuthRouteDeps): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    const row = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
    res.json({ bootstrapped: row.rows[0].count > 0 });
  });

  router.post('/bootstrap', async (req, res) => {
    if (req.header('x-bootstrap-token') !== config.BOOTSTRAP_TOKEN) {
      res.status(403).json({ error: 'Invalid bootstrap token' });
      return;
    }

    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { username, password, deviceName } = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
      if (existing.rows[0].count > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Bootstrap already completed' });
        return;
      }

      const passwordHash = await hashPassword(password);
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id`,
        [username, passwordHash]
      );
      const userId = userResult.rows[0].id;
      const deviceId = await createDevice(client, userId, deviceName);
      const tokenPair = issueTokenPair(config, userId, deviceId);

      await persistRefreshToken(client, userId, deviceId, tokenPair.refreshToken, tokenPair.refreshExpiresAt);
      await client.query('COMMIT');

      res.status(201).json({
        userId,
        username,
        deviceId,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        refreshExpiresAt: tokenPair.refreshExpiresAt.toISOString(),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[auth/bootstrap] failed', error);
      res.status(500).json({ error: 'Bootstrap failed' });
    } finally {
      client.release();
    }
  });

  router.post('/login', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { username, password, deviceName } = parsed.data;
    const client = await pool.connect();
    try {
      const userResult = await client.query<{ id: string; password_hash: string }>(
        `SELECT id, password_hash FROM users WHERE username = $1`,
        [username]
      );
      if (userResult.rowCount === 0) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const user = userResult.rows[0];
      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      await client.query('BEGIN');
      const deviceId = await createDevice(client, user.id, deviceName);
      const tokenPair = issueTokenPair(config, user.id, deviceId);
      await persistRefreshToken(client, user.id, deviceId, tokenPair.refreshToken, tokenPair.refreshExpiresAt);
      await client.query(
        `UPDATE devices SET last_seen_at = now() WHERE id = $1`,
        [deviceId]
      );
      await client.query('COMMIT');

      res.status(200).json({
        userId: user.id,
        username,
        deviceId,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        refreshExpiresAt: tokenPair.refreshExpiresAt.toISOString(),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[auth/login] failed', error);
      res.status(500).json({ error: 'Login failed' });
    } finally {
      client.release();
    }
  });

  router.post('/refresh', async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { refreshToken } = parsed.data;
    let tokenClaims;
    try {
      tokenClaims = verifyRefreshToken(config, refreshToken);
    } catch {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const tokenRow = await client.query<{
        user_id: string;
        device_id: string;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT user_id, device_id, expires_at, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );

      if (tokenRow.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(401).json({ error: 'Refresh token not recognized' });
        return;
      }

      const row = tokenRow.rows[0];
      const expired = row.expires_at.getTime() <= Date.now();
      if (row.revoked_at !== null || expired) {
        await client.query('ROLLBACK');
        res.status(401).json({ error: 'Refresh token expired or revoked' });
        return;
      }

      if (row.user_id !== tokenClaims.sub || row.device_id !== tokenClaims.did) {
        await client.query('ROLLBACK');
        res.status(401).json({ error: 'Refresh token subject mismatch' });
        return;
      }

      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`,
        [tokenHash]
      );

      const nextPair = issueTokenPair(config, row.user_id, row.device_id);
      await persistRefreshToken(
        client,
        row.user_id,
        row.device_id,
        nextPair.refreshToken,
        nextPair.refreshExpiresAt
      );
      await client.query(
        `UPDATE devices SET last_seen_at = now() WHERE id = $1`,
        [row.device_id]
      );

      await client.query('COMMIT');
      res.status(200).json({
        userId: row.user_id,
        deviceId: row.device_id,
        accessToken: nextPair.accessToken,
        refreshToken: nextPair.refreshToken,
        refreshExpiresAt: nextPair.refreshExpiresAt.toISOString(),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[auth/refresh] failed', error);
      res.status(500).json({ error: 'Failed to refresh token' });
    } finally {
      client.release();
    }
  });

  router.post('/logout', async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const tokenHash = hashRefreshToken(parsed.data.refreshToken);
    await pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );
    res.status(204).send();
  });

  return router;
}
