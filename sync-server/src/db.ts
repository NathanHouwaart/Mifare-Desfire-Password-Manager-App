import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';

import type { AppConfig } from './config.js';

export async function createPool(config: AppConfig): Promise<Pool> {
  const pool = new PgPool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  await pool.query('SELECT 1');
  await runMigrations(pool);

  return pool;
}

async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mfa_pending_secret TEXT;
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mfa_pending_created_at TIMESTAMPTZ;
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_device
      ON refresh_tokens (user_id, device_id);

    CREATE TABLE IF NOT EXISTS vault_items (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      ciphertext TEXT,
      iv TEXT,
      auth_tag TEXT,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (user_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_vault_items_user_updated
      ON vault_items (user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS sync_changes (
      seq BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_sync_changes_user_seq
      ON sync_changes (user_id, seq);

    CREATE TABLE IF NOT EXISTS user_key_envelopes (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      key_version INTEGER NOT NULL,
      kdf TEXT NOT NULL,
      kdf_params JSONB NOT NULL,
      salt TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
