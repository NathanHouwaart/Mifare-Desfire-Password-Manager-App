import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import { requireAccessToken } from '../authMiddleware.js';

interface SyncRouteDeps {
  pool: Pool;
  config: AppConfig;
}

const pullQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

const pushChangeSchema = z.object({
  itemId: z.string().min(1).max(200),
  label: z.string().max(500).optional(),
  url: z.string().max(4096).optional(),
  category: z.string().max(120).optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
  ciphertext: z.string().min(1).optional(),
  iv: z.string().min(1).optional(),
  authTag: z.string().min(1).optional(),
  deleted: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  if (!value.deleted && (!value.ciphertext || !value.iv || !value.authTag)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ciphertext, iv, and authTag are required when deleted=false',
      path: ['ciphertext'],
    });
  }
});

const pushBodySchema = z.object({
  changes: z.array(pushChangeSchema).min(1).max(500),
});

async function appendChangeLog(
  client: PoolClient,
  userId: string,
  itemId: string,
  updatedAt: number,
  deleted: boolean
): Promise<void> {
  await client.query(
    `INSERT INTO sync_changes (user_id, item_id, updated_at, deleted)
     VALUES ($1, $2, $3, $4)`,
    [userId, itemId, updatedAt, deleted]
  );
}

export function registerSyncRoutes({ pool, config }: SyncRouteDeps): Router {
  const router = Router();

  router.use(requireAccessToken(config));

  router.post('/push', async (req, res) => {
    const parsed = pushBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const client = await pool.connect();
    const applied: string[] = [];
    const skipped: Array<{ itemId: string; reason: string }> = [];

    try {
      await client.query('BEGIN');

      for (const change of parsed.data.changes) {
        const createdAt = change.createdAt ?? change.updatedAt;
        const itemId = change.itemId;

        let result;
        if (change.deleted) {
          result = await client.query(
            `INSERT INTO vault_items (
               user_id, item_id, label, url, category, created_at, updated_at,
               ciphertext, iv, auth_tag, deleted
             )
             VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''), COALESCE($5, ''), $6, $7, NULL, NULL, NULL, TRUE)
             ON CONFLICT (user_id, item_id) DO UPDATE SET
               label = EXCLUDED.label,
               url = EXCLUDED.url,
               category = EXCLUDED.category,
               updated_at = EXCLUDED.updated_at,
               ciphertext = NULL,
               iv = NULL,
               auth_tag = NULL,
               deleted = TRUE
             WHERE vault_items.updated_at < EXCLUDED.updated_at
             RETURNING item_id`,
            [userId, itemId, change.label, change.url, change.category, createdAt, change.updatedAt]
          );
        } else {
          result = await client.query(
            `INSERT INTO vault_items (
               user_id, item_id, label, url, category, created_at, updated_at,
               ciphertext, iv, auth_tag, deleted
             )
             VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''), COALESCE($5, ''), $6, $7, $8, $9, $10, FALSE)
             ON CONFLICT (user_id, item_id) DO UPDATE SET
               label = EXCLUDED.label,
               url = EXCLUDED.url,
               category = EXCLUDED.category,
               updated_at = EXCLUDED.updated_at,
               ciphertext = EXCLUDED.ciphertext,
               iv = EXCLUDED.iv,
               auth_tag = EXCLUDED.auth_tag,
               deleted = FALSE
             WHERE vault_items.updated_at < EXCLUDED.updated_at
             RETURNING item_id`,
            [
              userId,
              itemId,
              change.label,
              change.url,
              change.category,
              createdAt,
              change.updatedAt,
              change.ciphertext,
              change.iv,
              change.authTag,
            ]
          );
        }

        if (result.rowCount === 0) {
          skipped.push({ itemId, reason: 'stale_or_duplicate' });
          continue;
        }

        await appendChangeLog(client, userId, itemId, change.updatedAt, change.deleted ?? false);
        applied.push(itemId);
      }

      await client.query('COMMIT');

      const cursorResult = await pool.query<{ cursor: number }>(
        `SELECT COALESCE(MAX(seq), 0)::bigint AS cursor FROM sync_changes WHERE user_id = $1`,
        [userId]
      );

      res.status(200).json({
        applied,
        skipped,
        cursor: Number(cursorResult.rows[0].cursor),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[sync/push] failed', error);
      res.status(500).json({ error: 'Failed to process sync push' });
    } finally {
      client.release();
    }
  });

  router.get('/pull', async (req, res) => {
    const parsed = pullQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const { cursor, limit } = parsed.data;
    const result = await pool.query<{
      seq: string;
      itemId: string;
      label: string;
      url: string;
      category: string;
      createdAt: string;
      updatedAt: string;
      ciphertext: string | null;
      iv: string | null;
      authTag: string | null;
      deleted: boolean;
    }>(
      `SELECT
         ch.seq::text AS seq,
         vi.item_id AS "itemId",
         vi.label,
         vi.url,
         vi.category,
         vi.created_at::text AS "createdAt",
         vi.updated_at::text AS "updatedAt",
         vi.ciphertext,
         vi.iv,
         vi.auth_tag AS "authTag",
         vi.deleted
       FROM sync_changes ch
       JOIN vault_items vi
         ON vi.user_id = ch.user_id
        AND vi.item_id = ch.item_id
       WHERE ch.user_id = $1
         AND ch.seq > $2
       ORDER BY ch.seq ASC
       LIMIT $3`,
      [userId, cursor, limit]
    );

    const changes = result.rows.map((row) => ({
      seq: Number(row.seq),
      itemId: row.itemId,
      label: row.label,
      url: row.url,
      category: row.category,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      deleted: row.deleted,
    }));

    const nextCursor = changes.length > 0
      ? changes[changes.length - 1].seq
      : cursor;

    res.status(200).json({
      cursor,
      nextCursor,
      hasMore: changes.length === limit,
      changes,
    });
  });

  router.get('/cursor', async (req, res) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const result = await pool.query<{ cursor: string }>(
      `SELECT COALESCE(MAX(seq), 0)::text AS cursor
       FROM sync_changes
       WHERE user_id = $1`,
      [userId]
    );

    res.json({ cursor: Number(result.rows[0].cursor) });
  });

  return router;
}
