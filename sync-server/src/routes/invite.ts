import crypto from 'node:crypto';

import { Router } from 'express';
import type { Request } from 'express';
import ms from 'ms';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import { requireAccessToken } from '../authMiddleware.js';

interface InviteRouteDeps {
  pool: Pool;
  config: AppConfig;
  publicBaseUrl?: string;
}

const usernameSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value : undefined),
  z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/).optional()
);

const inviteQuerySchema = z.object({
  username: usernameSchema,
});

const createInviteSchema = z.object({
  note: z.string().max(120).optional(),
  expiresIn: z.string().default('24h'),
});

function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeServerUrl(raw: string): string {
  const parsed = new URL(raw.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invite server URL must use http or https');
  }
  const trimmedPath = parsed.pathname.endsWith('/') && parsed.pathname !== '/'
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname;
  parsed.pathname = trimmedPath;
  return parsed.toString().replace(/\/$/, '');
}

function inferServerUrlFromRequest(req: Request): string {
  const host = req.get('host');
  if (!host) {
    throw new Error('Missing Host header');
  }
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto?.split(',')[0]?.trim() || req.protocol || 'http';
  return normalizeServerUrl(`${protocol}://${host}`);
}

function buildInviteUrl(serverUrl: string, username?: string, inviteToken?: string): string {
  const invite = new URL('securepass://invite');
  invite.searchParams.set('server', serverUrl);
  if (username) invite.searchParams.set('username', username);
  if (inviteToken) invite.searchParams.set('token', inviteToken);
  return invite.toString();
}

export function registerInviteRoutes({ pool, config, publicBaseUrl }: InviteRouteDeps): Router {
  const router = Router();
  const fixedBaseUrl = publicBaseUrl ? normalizeServerUrl(publicBaseUrl) : null;
  if (config.NODE_ENV === 'production' && !fixedBaseUrl) {
    throw new Error('PUBLIC_BASE_URL must be set in production for invite links');
  }

  const buildPayload = (req: Request, username?: string, inviteToken?: string) => {
    const serverUrl = fixedBaseUrl ?? inferServerUrlFromRequest(req);
    const inviteUrl = buildInviteUrl(serverUrl, username, inviteToken);
    return {
      inviteUrl,
      serverUrl,
      ...(username ? { username } : {}),
    };
  };

  const assertInviteManagementAllowed = async (userId: string): Promise<void> => {
    if (config.INVITE_CREATION_POLICY === 'any') return;

    const row = await pool.query<{ is_admin: boolean }>(
      `SELECT is_admin
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if ((row.rowCount ?? 0) === 0 || !row.rows[0].is_admin) {
      const denied = new Error('Only admin users can manage invites on this server');
      (denied as Error & { status?: number }).status = 403;
      throw denied;
    }
  };

  router.get('/link', (req, res) => {
    const parsed = inviteQuerySchema.safeParse({ username: req.query.username });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      res.status(200).json(buildPayload(req, parsed.data.username));
    } catch (error) {
      console.error('[invite/link] failed', error);
      res.status(500).json({ error: 'Failed to generate invite link' });
    }
  });

  router.get('/open', (req, res) => {
    const parsed = inviteQuerySchema.safeParse({ username: req.query.username });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const payload = buildPayload(req, parsed.data.username);
      res.redirect(payload.inviteUrl);
    } catch (error) {
      console.error('[invite/open] failed', error);
      res.status(500).json({ error: 'Failed to generate invite redirect' });
    }
  });

  // --- Authenticated invite token management ---

  // POST /v1/invite/create  — generate a single-use token to send to someone
  router.post('/create', requireAccessToken(config), async (req, res) => {
    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const ttlMs = ms(parsed.data.expiresIn);
    if (typeof ttlMs !== 'number' || ttlMs <= 0) {
      res.status(400).json({ error: 'Invalid expiresIn duration (e.g. "24h", "7d")' });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlMs);

    try {
      await assertInviteManagementAllowed(req.auth!.sub);

      const row = await pool.query<{ id: string; note: string | null; expires_at: Date; created_at: Date }>(
        `INSERT INTO invite_tokens (token_hash, created_by, note, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, note, expires_at, created_at`,
        [tokenHash, req.auth!.sub, parsed.data.note ?? null, expiresAt]
      );
      const invite = row.rows[0];
      const payload = buildPayload(req, undefined, rawToken);
      res.status(201).json({
        id: invite.id,
        token: rawToken,
        inviteUrl: payload.inviteUrl,
        serverUrl: payload.serverUrl,
        note: invite.note,
        expiresAt: invite.expires_at,
        createdAt: invite.created_at,
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { status?: number }).status === 403) {
        res.status(403).json({ error: 'Only admin users can manage invites on this server' });
        return;
      }
      console.error('[invite/create] failed', error);
      res.status(500).json({ error: 'Failed to create invite token' });
    }
  });

  // GET /v1/invite/list  — view all tokens you have created
  router.get('/list', requireAccessToken(config), async (req, res) => {
    try {
      await assertInviteManagementAllowed(req.auth!.sub);

      const rows = await pool.query<{
        id: string;
        note: string | null;
        expires_at: Date;
        used_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, note, expires_at, used_at, created_at
         FROM invite_tokens
         WHERE created_by = $1
         ORDER BY created_at DESC`,
        [req.auth!.sub]
      );
      res.status(200).json({
        invites: rows.rows.map((row) => ({
          id: row.id,
          note: row.note,
          expiresAt: row.expires_at,
          expired: row.expires_at < new Date(),
          used: row.used_at !== null,
          usedAt: row.used_at,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { status?: number }).status === 403) {
        res.status(403).json({ error: 'Only admin users can manage invites on this server' });
        return;
      }
      console.error('[invite/list] failed', error);
      res.status(500).json({ error: 'Failed to list invite tokens' });
    }
  });

  // DELETE /v1/invite/:id  — revoke an unused token
  router.delete('/:id', requireAccessToken(config), async (req, res) => {
    try {
      await assertInviteManagementAllowed(req.auth!.sub);

      const result = await pool.query(
        `DELETE FROM invite_tokens
         WHERE id = $1 AND created_by = $2 AND used_at IS NULL
         RETURNING id`,
        [req.params.id, req.auth!.sub]
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: 'Invite not found or already used' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { status?: number }).status === 403) {
        res.status(403).json({ error: 'Only admin users can manage invites on this server' });
        return;
      }
      console.error('[invite/delete] failed', error);
      res.status(500).json({ error: 'Failed to revoke invite token' });
    }
  });

  return router;
}
