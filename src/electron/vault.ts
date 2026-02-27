/**
 * vault.ts
 *
 * SQLite-backed vault storage. Responsible for schema migrations and raw CRUD.
 * This module only stores and retrieves encrypted blobs — it has no knowledge
 * of keys or plaintext. Decryption/encryption is handled by vaultHandlers.ts.
 *
 * Must only run in the main process.
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Full DB row including encrypted blobs — used by vault handlers for decryption. */
export interface EntryRow {
  id: string;
  label: string;
  url: string;
  category: string;
  createdAt: number;
  updatedAt: number;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** List-safe subset — no blobs, no decryption needed. */
export interface EntryListItem {
  id: string;
  label: string;
  url: string;
  category: string;
  createdAt: number;
  updatedAt: number;
}

/** Plaintext fields for insert/update, along with the already-encrypted blob. */
export interface EntryWriteData {
  label: string;
  url: string;
  category: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** Deleted entry tombstone used for remote sync propagation. */
export interface TombstoneRow {
  id: string;
  updatedAt: number;
}

/** Row format used by sync push/pull operations. */
export interface SyncEntryRow {
  id: string;
  label: string;
  url: string;
  category: string;
  createdAt: number;
  updatedAt: number;
  ciphertext: string;
  iv: string;
  authTag: string;
  deleted: boolean;
}

export interface OutboxRow {
  id: string;
  updatedAt: number;
  deleted: boolean;
}

// ── Schema migrations ─────────────────────────────────────────────────────────

/**
 * Each migration takes the DB from version (index) to version (index + 1).
 * The migration is responsible for setting the new version in schema_version.
 */
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v0 → v1 — initial schema
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entries (
        id          TEXT    PRIMARY KEY,
        label       TEXT    NOT NULL,
        url         TEXT    NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        ciphertext  BLOB    NOT NULL,
        iv          BLOB    NOT NULL,
        auth_tag    BLOB    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entries_label
        ON entries(label COLLATE NOCASE);

      CREATE INDEX IF NOT EXISTS idx_entries_updated
        ON entries(updated_at DESC);
    `);
    db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
  },

  // v1 → v2 — add category column for filterable metadata
  (db) => {
    db.exec(`ALTER TABLE entries ADD COLUMN category TEXT NOT NULL DEFAULT ''`);
    db.prepare('UPDATE schema_version SET version = 2').run();
  },

  // v2 → v3 — add sync metadata tables (cursor/state + delete tombstones)
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_tombstones (
        id          TEXT    PRIMARY KEY,
        updated_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tombstones_updated
        ON deleted_tombstones(updated_at DESC);

      CREATE TABLE IF NOT EXISTS sync_state (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );
    `);
    db.prepare('UPDATE schema_version SET version = 3').run();
  },

  // v3 → v4 — add durable outbox queue for local-only changes
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id          TEXT PRIMARY KEY,
        updated_at  INTEGER NOT NULL,
        deleted     INTEGER NOT NULL CHECK (deleted IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_updated
        ON sync_outbox(updated_at ASC);
    `);
    db.prepare('UPDATE schema_version SET version = 4').run();
  },
];

function runMigrations(db: Database.Database): void {
  const tableExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`
  ).get() != null;

  let version = 0;
  if (tableExists) {
    const row = db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;
    version = row?.version ?? 0;
  }

  const target = MIGRATIONS.length;
  if (version > target) {
    throw new Error(
      `vault.db schema version ${version} is newer than this app supports (${target}). ` +
      `Please upgrade the app.`
    );
  }

  for (let i = version; i < target; i++) {
    // Each migration runs in its own transaction so a partial migration
    // never leaves the schema in a broken state.
    db.transaction(() => MIGRATIONS[i](db))();
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) throw new Error('Vault not initialised — call openVault() first');
  return _db;
}

export function openVault(): void {
  const dbPath = path.join(app.getPath('userData'), 'vault.db');
  console.log("Database Path", dbPath);
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
}

export function closeVault(): void {
  _db?.close();
  _db = null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function listEntries(opts: {
  offset?: number;
  limit?: number;
  query?: string;
} = {}): EntryListItem[] {
  const db = getDb();
  const { offset = 0, limit = 200, query } = opts;

  if (query) {
    const like = `%${query}%`;
    return db.prepare(`
      SELECT id, label, url, category,
             created_at AS createdAt,
             updated_at AS updatedAt
      FROM   entries
      WHERE  label LIKE ? OR url LIKE ?
      ORDER  BY updated_at DESC
      LIMIT  ? OFFSET ?
    `).all(like, like, limit, offset) as EntryListItem[];
  }

  return db.prepare(`
    SELECT id, label, url, category,
           created_at AS createdAt,
           updated_at AS updatedAt
    FROM   entries
    ORDER  BY updated_at DESC
    LIMIT  ? OFFSET ?
  `).all(limit, offset) as EntryListItem[];
}

/** Returns the full row including encrypted blob — needed to decrypt. */
export function getEntryRow(id: string): EntryRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT id, label, url, category,
           created_at AS createdAt,
           updated_at AS updatedAt,
           ciphertext,
           iv,
           auth_tag   AS authTag
    FROM   entries
    WHERE  id = ?
  `).get(id) as EntryRow | undefined;
}

export function insertEntry(id: string, data: EntryWriteData): EntryListItem {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction((entryId: string) => {
    db.prepare(`
      INSERT INTO entries (id, label, url, category, created_at, updated_at, ciphertext, iv, auth_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entryId, data.label, data.url, data.category, now, now, data.ciphertext, data.iv, data.authTag);

    db.prepare('DELETE FROM deleted_tombstones WHERE id = ?').run(entryId);
    db.prepare(`
      INSERT INTO sync_outbox (id, updated_at, deleted)
      VALUES (?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        deleted = 0
    `).run(entryId, now);
  });
  tx(id);
  return { id, label: data.label, url: data.url, category: data.category, createdAt: now, updatedAt: now };
}

/** Returns updated list item, or undefined if the id was not found. */
export function updateEntry(id: string, data: EntryWriteData): EntryListItem | undefined {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction((entryId: string) => {
    const result = db.prepare(`
      UPDATE entries
      SET    label      = ?,
             url        = ?,
             category   = ?,
             updated_at = ?,
             ciphertext = ?,
             iv         = ?,
             auth_tag   = ?
      WHERE  id = ?
    `).run(data.label, data.url, data.category, now, data.ciphertext, data.iv, data.authTag, entryId);

    if (result.changes === 0) return undefined;

    db.prepare('DELETE FROM deleted_tombstones WHERE id = ?').run(entryId);
    db.prepare(`
      INSERT INTO sync_outbox (id, updated_at, deleted)
      VALUES (?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        deleted = 0
    `).run(entryId, now);

    const row = db.prepare('SELECT created_at AS createdAt FROM entries WHERE id = ?')
      .get(entryId) as { createdAt: number };
    return { id: entryId, label: data.label, url: data.url, category: data.category, createdAt: row.createdAt, updatedAt: now };
  });

  return tx(id);
}

/** Permanently deletes an entry. Returns true if a row was deleted. */
export function deleteEntry(id: string): boolean {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction((entryId: string, ts: number) => {
    const deleted = db.prepare('DELETE FROM entries WHERE id = ?').run(entryId).changes > 0;
    if (deleted) {
      db.prepare(`
        INSERT INTO deleted_tombstones (id, updated_at)
        VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET
          updated_at = excluded.updated_at
      `).run(entryId, ts);
      db.prepare(`
        INSERT INTO sync_outbox (id, updated_at, deleted)
        VALUES (?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          updated_at = excluded.updated_at,
          deleted = 1
      `).run(entryId, ts);
    }
    return deleted;
  });
  return tx(id, now);
}

/**
 * Deletes all entries from the vault.
 * Called by card:format after formatPicc() destroys the card secret.
 * With the secret gone, all derived entry keys are permanently irrecoverable.
 */
export function wipeVault(): void {
  const db = getDb();
  db.exec('DELETE FROM entries');
  db.exec('DELETE FROM deleted_tombstones');
  db.exec('DELETE FROM sync_outbox');
}

/** Returns all full rows including encrypted blobs — used by vault:export. */
export function getAllEntryRows(): EntryRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, label, url, category,
           created_at AS createdAt,
           updated_at AS updatedAt,
           ciphertext,
           iv,
           auth_tag AS authTag
    FROM   entries
    ORDER  BY created_at ASC
  `).all() as EntryRow[];
}

/**
 * Inserts a pre-encrypted row verbatim (from a backup import).
 * Returns true if inserted, false if the entry ID already exists (skipped).
 */
export function insertEntryRaw(row: EntryRow): boolean {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO entries
        (id, label, url, category, created_at, updated_at, ciphertext, iv, auth_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.label, row.url, row.category,
      row.createdAt, row.updatedAt,
      row.ciphertext, row.iv, row.authTag,
    );
    return true;
  } catch {
    // UNIQUE constraint violation — entry already exists; skip silently.
    return false;
  }
}

/** Returns encrypted entry rows changed since the given timestamp (inclusive of greater only). */
export function getEntriesUpdatedSince(sinceTs: number, limit = 1000): EntryRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, label, url, category,
           created_at AS createdAt,
           updated_at AS updatedAt,
           ciphertext,
           iv,
           auth_tag AS authTag
    FROM entries
    WHERE updated_at > ?
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(sinceTs, limit) as EntryRow[];
}

/** Returns local delete tombstones changed since the given timestamp. */
export function getTombstonesUpdatedSince(sinceTs: number, limit = 1000): TombstoneRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, updated_at AS updatedAt
    FROM deleted_tombstones
    WHERE updated_at > ?
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(sinceTs, limit) as TombstoneRow[];
}

/** LWW upsert from remote sync payload. Returns true when applied, false when stale. */
export function applyRemoteUpsert(row: SyncEntryRow): boolean {
  const db = getDb();
  const tx = db.transaction((payload: SyncEntryRow) => {
    if (payload.deleted) return false;

    const existing = db.prepare(`
      SELECT id, updated_at AS updatedAt
      FROM entries
      WHERE id = ?
    `).get(payload.id) as { id: string; updatedAt: number } | undefined;

    const tomb = db.prepare(`
      SELECT id, updated_at AS updatedAt
      FROM deleted_tombstones
      WHERE id = ?
    `).get(payload.id) as { id: string; updatedAt: number } | undefined;

    const currentMaxTs = Math.max(existing?.updatedAt ?? 0, tomb?.updatedAt ?? 0);
    if (currentMaxTs >= payload.updatedAt) return false;

    db.prepare(`
      DELETE FROM deleted_tombstones
      WHERE id = ?
    `).run(payload.id);

    db.prepare(`
      INSERT INTO entries (
        id, label, url, category, created_at, updated_at, ciphertext, iv, auth_tag
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        url = excluded.url,
        category = excluded.category,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag
      WHERE entries.updated_at < excluded.updated_at
    `).run(
      payload.id,
      payload.label,
      payload.url,
      payload.category,
      payload.createdAt,
      payload.updatedAt,
      Buffer.from(payload.ciphertext, 'base64'),
      Buffer.from(payload.iv, 'base64'),
      Buffer.from(payload.authTag, 'base64'),
    );

    db.prepare('DELETE FROM sync_outbox WHERE id = ?').run(payload.id);

    return true;
  });

  return tx(row);
}

/** Applies remote delete tombstone with LWW semantics. */
export function applyRemoteDelete(id: string, updatedAt: number): boolean {
  const db = getDb();
  const tx = db.transaction((entryId: string, ts: number) => {
    const existing = db.prepare(`
      SELECT id, updated_at AS updatedAt
      FROM entries
      WHERE id = ?
    `).get(entryId) as { id: string; updatedAt: number } | undefined;

    const tomb = db.prepare(`
      SELECT id, updated_at AS updatedAt
      FROM deleted_tombstones
      WHERE id = ?
    `).get(entryId) as { id: string; updatedAt: number } | undefined;

    const currentMaxTs = Math.max(existing?.updatedAt ?? 0, tomb?.updatedAt ?? 0);
    if (currentMaxTs >= ts) return false;

    db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
    db.prepare(`
      INSERT INTO deleted_tombstones (id, updated_at)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at
    `).run(entryId, ts);

    db.prepare('DELETE FROM sync_outbox WHERE id = ?').run(entryId);

    return true;
  });

  return tx(id, updatedAt);
}

/** Generic sync state key-value store, persisted in SQLite. */
export function getSyncStateValue(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT value
    FROM sync_state
    WHERE key = ?
  `).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSyncStateValue(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value
  `).run(key, value);
}

export function listOutbox(limit = 500): OutboxRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      id,
      updated_at AS updatedAt,
      deleted
    FROM sync_outbox
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(limit) as Array<{ id: string; updatedAt: number; deleted: number }>;

  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    deleted: row.deleted === 1,
  }));
}

/**
 * One-time helper for legacy vaults that predate sync_outbox tracking.
 * Queues all existing entries as upserts so the first sync can seed the server.
 */
export function seedOutboxFromEntries(): number {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, updated_at AS updatedAt
    FROM entries
  `).all() as Array<{ id: string; updatedAt: number }>;

  if (rows.length === 0) return 0;

  const tx = db.transaction((items: Array<{ id: string; updatedAt: number }>) => {
    const stmt = db.prepare(`
      INSERT INTO sync_outbox (id, updated_at, deleted)
      VALUES (?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        deleted = 0
      WHERE sync_outbox.updated_at < excluded.updated_at
         OR sync_outbox.deleted <> 0
    `);
    for (const row of items) {
      stmt.run(row.id, row.updatedAt);
    }
  });

  tx(rows);
  return rows.length;
}

export function clearOutbox(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const tx = db.transaction((values: readonly string[]) => {
    const stmt = db.prepare('DELETE FROM sync_outbox WHERE id = ?');
    for (const id of values) stmt.run(id);
  });
  tx(ids);
}
