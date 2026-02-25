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
  db.prepare(`
    INSERT INTO entries (id, label, url, category, created_at, updated_at, ciphertext, iv, auth_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.label, data.url, data.category, now, now, data.ciphertext, data.iv, data.authTag);
  return { id, label: data.label, url: data.url, category: data.category, createdAt: now, updatedAt: now };
}

/** Returns updated list item, or undefined if the id was not found. */
export function updateEntry(id: string, data: EntryWriteData): EntryListItem | undefined {
  const db = getDb();
  const now = Date.now();
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
  `).run(data.label, data.url, data.category, now, data.ciphertext, data.iv, data.authTag, id);

  if (result.changes === 0) return undefined;

  const row = db.prepare('SELECT created_at AS createdAt FROM entries WHERE id = ?')
    .get(id) as { createdAt: number };
  return { id, label: data.label, url: data.url, category: data.category, createdAt: row.createdAt, updatedAt: now };
}

/** Permanently deletes an entry. Returns true if a row was deleted. */
export function deleteEntry(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM entries WHERE id = ?').run(id).changes > 0;
}

/**
 * Deletes all entries from the vault.
 * Called by card:format after formatPicc() destroys the card secret.
 * With the secret gone, all derived entry keys are permanently irrecoverable.
 */
export function wipeVault(): void {
  getDb().exec('DELETE FROM entries');
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
