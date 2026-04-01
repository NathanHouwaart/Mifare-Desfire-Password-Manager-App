import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import { requireAccessToken } from '../authMiddleware.js';

interface KeysRouteDeps {
  pool: Pool;
  config: AppConfig;
}

const envelopeSchema = z.object({
  keyVersion: z.number().int().min(1).max(2_147_483_647),
  kdf: z.literal('scrypt-v1'),
  kdfParams: z.object({
    N: z.number().int().min(16_384).max(1_048_576),
    r: z.number().int().min(1).max(32),
    p: z.number().int().min(1).max(16),
    dkLen: z.number().int().min(32).max(64),
  }),
  salt: z.string().min(16).max(2048),
  nonce: z.string().min(16).max(2048),
  ciphertext: z.string().min(16).max(200_000),
  authTag: z.string().min(16).max(2048),
});

const putEnvelopeSchema = z.object({
  envelope: envelopeSchema,
});

type EnvelopeDto = z.infer<typeof envelopeSchema> & { updatedAt: string };

function mapRowToEnvelope(row: {
  key_version: number;
  kdf: string;
  kdf_params: unknown;
  salt: string;
  nonce: string;
  ciphertext: string;
  auth_tag: string;
  updated_at: Date;
}): EnvelopeDto {
  return {
    keyVersion: row.key_version,
    kdf: row.kdf as 'scrypt-v1',
    kdfParams: row.kdf_params as EnvelopeDto['kdfParams'],
    salt: row.salt,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    authTag: row.auth_tag,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function registerKeyRoutes({ pool, config }: KeysRouteDeps): Router {
  const router = Router();
  router.use(requireAccessToken(config));

  router.get('/envelope', async (req, res) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const row = await pool.query<{
      key_version: number;
      kdf: string;
      kdf_params: unknown;
      salt: string;
      nonce: string;
      ciphertext: string;
      auth_tag: string;
      updated_at: Date;
    }>(
      `SELECT
         key_version,
         kdf,
         kdf_params,
         salt,
         nonce,
         ciphertext,
         auth_tag,
         updated_at
       FROM user_key_envelopes
       WHERE user_id = $1`,
      [userId]
    );

    if (row.rowCount === 0) {
      res.status(200).json({ envelope: null });
      return;
    }

    res.status(200).json({ envelope: mapRowToEnvelope(row.rows[0]) });
  });

  router.put('/envelope', async (req, res) => {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Missing auth context' });
      return;
    }

    const parsed = putEnvelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const envelope = parsed.data.envelope;
    const upserted = await pool.query<{
      key_version: number;
      kdf: string;
      kdf_params: unknown;
      salt: string;
      nonce: string;
      ciphertext: string;
      auth_tag: string;
      updated_at: Date;
    }>(
      `INSERT INTO user_key_envelopes (
         user_id,
         key_version,
         kdf,
         kdf_params,
         salt,
         nonce,
         ciphertext,
         auth_tag
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         key_version = EXCLUDED.key_version,
         kdf = EXCLUDED.kdf,
         kdf_params = EXCLUDED.kdf_params,
         salt = EXCLUDED.salt,
         nonce = EXCLUDED.nonce,
         ciphertext = EXCLUDED.ciphertext,
         auth_tag = EXCLUDED.auth_tag,
         updated_at = now()
       RETURNING
         key_version,
         kdf,
         kdf_params,
         salt,
         nonce,
         ciphertext,
         auth_tag,
         updated_at`,
      [
        userId,
        envelope.keyVersion,
        envelope.kdf,
        JSON.stringify(envelope.kdfParams),
        envelope.salt,
        envelope.nonce,
        envelope.ciphertext,
        envelope.authTag,
      ]
    );

    res.status(200).json({ envelope: mapRowToEnvelope(upserted.rows[0]) });
  });

  return router;
}

