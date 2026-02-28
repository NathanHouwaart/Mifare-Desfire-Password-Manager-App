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
import { requireAccessToken } from '../authMiddleware.js';
import { buildTotpUri, isTotpCodeFormat, generateTotpSecret, verifyTotpCode } from '../mfa.js';

interface AuthRouteDeps {
  pool: Pool;
  config: AppConfig;
}

const usernameSchema = z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/);
const passwordSchema = z.string().min(10).max(256);
const deviceNameSchema = z.string().min(1).max(120).default('desktop');
const mfaCodeSchema = z.string().trim().regex(/^[0-9]{6}$/);

const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  deviceName: deviceNameSchema,
});

const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  deviceName: deviceNameSchema,
  mfaCode: mfaCodeSchema.optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const userExistsQuerySchema = z.object({
  username: usernameSchema,
});

const mfaCodeOnlySchema = z.object({
  code: mfaCodeSchema,
});

const updateCurrentDeviceSchema = z.object({
  name: deviceNameSchema,
});

interface NewSession {
  userId: string;
  username: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  mfaEnabled: boolean;
}

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

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // No-op. Rollback is best effort in error paths.
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

async function createUserSession(
  client: PoolClient,
  config: AppConfig,
  input: { username: string; password: string; deviceName: string }
): Promise<NewSession> {
  const passwordHash = await hashPassword(input.password);
  const userResult = await client.query<{ id: string; username: string; mfa_enabled: boolean }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     RETURNING id, username, mfa_enabled`,
    [input.username, passwordHash]
  );

  const user = userResult.rows[0];
  const deviceId = await createDevice(client, user.id, input.deviceName);
  const tokenPair = issueTokenPair(config, user.id, deviceId);
  await persistRefreshToken(client, user.id, deviceId, tokenPair.refreshToken, tokenPair.refreshExpiresAt);

  return {
    userId: user.id,
    username: user.username,
    deviceId,
    accessToken: tokenPair.accessToken,
    refreshToken: tokenPair.refreshToken,
    refreshExpiresAt: tokenPair.refreshExpiresAt.toISOString(),
    mfaEnabled: user.mfa_enabled,
  };
}

export function registerAuthRoutes({ pool, config }: AuthRouteDeps): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    const row = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
    const userCount = row.rows[0].count;
    const hasUsers = userCount > 0;
    res.json({
      userCount,
      hasUsers,
      bootstrapped: hasUsers, // Deprecated field kept temporarily for old clients.
    });
  });

  router.get('/user-exists', async (req, res) => {
    const parsed = userExistsQuerySchema.safeParse({ username: req.query.username });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const row = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1) AS exists`,
      [parsed.data.username]
    );

    res.status(200).json({ exists: Boolean(row.rows[0]?.exists) });
  });

  router.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const session = await createUserSession(client, config, parsed.data);
      await client.query('COMMIT');
      res.status(201).json(session);
    } catch (error) {
      await safeRollback(client);
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: 'Username already exists' });
        return;
      }
      console.error('[auth/register] failed', error);
      res.status(500).json({ error: 'Registration failed' });
    } finally {
      client.release();
    }
  });

  // Deprecated: legacy first-user bootstrap flow. Kept temporarily during v2 migration.
  router.post('/bootstrap', async (req, res) => {
    if (req.header('x-bootstrap-token') !== config.BOOTSTRAP_TOKEN) {
      res.status(403).json({ error: 'Invalid bootstrap token' });
      return;
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
      if (existing.rows[0].count > 0) {
        await safeRollback(client);
        res.status(409).json({ error: 'Bootstrap already completed' });
        return;
      }

      const session = await createUserSession(client, config, parsed.data);
      await client.query('COMMIT');
      res.status(201).json(session);
    } catch (error) {
      await safeRollback(client);
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: 'Username already exists' });
        return;
      }
      console.error('[auth/bootstrap] failed', error);
      res.status(500).json({ error: 'Bootstrap failed' });
    } finally {
      client.release();
    }
  });

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { username, password, deviceName, mfaCode } = parsed.data;
    const userResult = await pool.query<{
      id: string;
      password_hash: string;
      mfa_enabled: boolean;
      mfa_secret: string | null;
    }>(
      `SELECT id, password_hash, mfa_enabled, mfa_secret
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (userResult.rowCount === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = userResult.rows[0];
    const passwordOk = await verifyPassword(user.password_hash, password);
    if (!passwordOk) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.mfa_enabled) {
      if (!user.mfa_secret) {
        res.status(500).json({ error: 'MFA is enabled but no secret is configured' });
        return;
      }

      if (!mfaCode) {
        res.status(401).json({ error: 'MFA_REQUIRED', mfaRequired: true });
        return;
      }

      if (!verifyTotpCode(user.mfa_secret, mfaCode)) {
        res.status(401).json({ error: 'INVALID_MFA_CODE', mfaRequired: true });
        return;
      }
    }

    const client = await pool.connect();
    try {
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
        mfaEnabled: user.mfa_enabled,
      });
    } catch (error) {
      await safeRollback(client);
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
        await safeRollback(client);
        res.status(401).json({ error: 'Refresh token not recognized' });
        return;
      }

      const row = tokenRow.rows[0];
      const expired = row.expires_at.getTime() <= Date.now();
      if (row.revoked_at !== null || expired) {
        await safeRollback(client);
        res.status(401).json({ error: 'Refresh token expired or revoked' });
        return;
      }

      if (row.user_id !== tokenClaims.sub || row.device_id !== tokenClaims.did) {
        await safeRollback(client);
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
      await safeRollback(client);
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

  router.get('/devices', requireAccessToken(config), async (req, res) => {
    const userId = req.auth?.sub;
    const currentDeviceId = req.auth?.did;
    if (!userId || !currentDeviceId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const rows = await pool.query<{
      id: string;
      name: string;
      created_at: Date;
      last_seen_at: Date;
      active: boolean;
    }>(
      `SELECT
         d.id,
         d.name,
         d.created_at,
         d.last_seen_at,
         EXISTS(
           SELECT 1
           FROM refresh_tokens rt
           WHERE rt.user_id = d.user_id
             AND rt.device_id = d.id
             AND rt.revoked_at IS NULL
             AND rt.expires_at > now()
         ) AS active
       FROM devices d
       WHERE d.user_id = $1
       ORDER BY d.last_seen_at DESC, d.created_at DESC`,
      [userId]
    );

    res.status(200).json({
      devices: rows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        active: Boolean(row.active),
        isCurrent: row.id === currentDeviceId,
      })),
    });
  });

  router.patch('/devices/current', requireAccessToken(config), async (req, res) => {
    const userId = req.auth?.sub;
    const currentDeviceId = req.auth?.did;
    if (!userId || !currentDeviceId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const parsed = updateCurrentDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const updated = await pool.query<{
      id: string;
      name: string;
      created_at: Date;
      last_seen_at: Date;
      active: boolean;
    }>(
      `UPDATE devices d
       SET name = $3,
           last_seen_at = now()
       WHERE d.id = $1
         AND d.user_id = $2
       RETURNING
         d.id,
         d.name,
         d.created_at,
         d.last_seen_at,
         EXISTS(
           SELECT 1
           FROM refresh_tokens rt
           WHERE rt.user_id = d.user_id
             AND rt.device_id = d.id
             AND rt.revoked_at IS NULL
             AND rt.expires_at > now()
         ) AS active`,
      [currentDeviceId, userId, parsed.data.name]
    );

    if (updated.rowCount === 0) {
      res.status(404).json({ error: 'Current device not found' });
      return;
    }

    const row = updated.rows[0];
    res.status(200).json({
      device: {
        id: row.id,
        name: row.name,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        active: Boolean(row.active),
        isCurrent: true,
      },
    });
  });

  router.get('/mfa/status', requireAccessToken(config), async (req, res) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const row = await pool.query<{
      mfa_enabled: boolean;
      mfa_pending_secret: string | null;
    }>(
      `SELECT mfa_enabled, mfa_pending_secret
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (row.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({
      mfaEnabled: row.rows[0].mfa_enabled,
      pendingEnrollment: row.rows[0].mfa_pending_secret !== null,
    });
  });

  router.post('/mfa/setup', requireAccessToken(config), async (req, res) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const row = await pool.query<{
      username: string;
      mfa_enabled: boolean;
    }>(
      `SELECT username, mfa_enabled
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (row.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (row.rows[0].mfa_enabled) {
      res.status(409).json({ error: 'MFA already enabled' });
      return;
    }

    const secret = generateTotpSecret();
    await pool.query(
      `UPDATE users
       SET mfa_pending_secret = $2,
           mfa_pending_created_at = now()
       WHERE id = $1`,
      [userId, secret]
    );

    res.status(200).json({
      issuer: config.MFA_ISSUER,
      accountName: row.rows[0].username,
      secret,
      otpauthUrl: buildTotpUri(config.MFA_ISSUER, row.rows[0].username, secret),
    });
  });

  router.post('/mfa/enable', requireAccessToken(config), async (req, res) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const parsed = mfaCodeOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    if (!isTotpCodeFormat(parsed.data.code)) {
      res.status(400).json({ error: 'Invalid MFA code format' });
      return;
    }

    const row = await pool.query<{
      mfa_enabled: boolean;
      mfa_pending_secret: string | null;
    }>(
      `SELECT mfa_enabled, mfa_pending_secret
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (row.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (row.rows[0].mfa_enabled) {
      res.status(409).json({ error: 'MFA already enabled' });
      return;
    }

    const pendingSecret = row.rows[0].mfa_pending_secret;
    if (!pendingSecret) {
      res.status(400).json({ error: 'No pending MFA setup. Call /mfa/setup first.' });
      return;
    }

    if (!verifyTotpCode(pendingSecret, parsed.data.code)) {
      res.status(401).json({ error: 'Invalid MFA code' });
      return;
    }

    await pool.query(
      `UPDATE users
       SET mfa_enabled = TRUE,
           mfa_secret = mfa_pending_secret,
           mfa_pending_secret = NULL,
           mfa_pending_created_at = NULL,
           mfa_enrolled_at = now()
       WHERE id = $1`,
      [userId]
    );

    res.status(200).json({ mfaEnabled: true });
  });

  router.post('/mfa/disable', requireAccessToken(config), async (req, res) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const parsed = mfaCodeOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const row = await pool.query<{
      mfa_enabled: boolean;
      mfa_secret: string | null;
    }>(
      `SELECT mfa_enabled, mfa_secret
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (row.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!row.rows[0].mfa_enabled || !row.rows[0].mfa_secret) {
      res.status(409).json({ error: 'MFA is not enabled' });
      return;
    }

    if (!verifyTotpCode(row.rows[0].mfa_secret, parsed.data.code)) {
      res.status(401).json({ error: 'Invalid MFA code' });
      return;
    }

    await pool.query(
      `UPDATE users
       SET mfa_enabled = FALSE,
           mfa_secret = NULL,
           mfa_pending_secret = NULL,
           mfa_pending_created_at = NULL,
           mfa_enrolled_at = NULL
       WHERE id = $1`,
      [userId]
    );

    res.status(200).json({ mfaEnabled: false });
  });

  return router;
}
