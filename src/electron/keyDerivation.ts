/**
 * keyDerivation.ts
 *
 * All cryptographic operations for the vault.
 * This module must only ever run in the main process — never in the renderer.
 *
 * Key hierarchy:
 *   machineSecret (32 B)  ─┐
 *   uid (4/7/10 B)         ├─► HKDF ─► DESFire app key  (16 B, AES-128)
 *                          │
 *   machineSecret (32 B)  ─┐
 *   cardSecret    (16 B)   ├─► HKDF ─► entryKey          (32 B, AES-256)
 *   entryId (UUID)         │
 */

import crypto from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────────────

/** Plaintext fields stored encrypted inside each vault entry ciphertext. */
export interface EntryPayload {
  username: string;
  password: string;
  totpSecret?: string;
  notes?: string;
}

/** Output of encryptEntry — all three blobs must be stored and retrieved together. */
export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;       // 12 bytes, random per write
  authTag: Buffer;  // 16 bytes GCM authentication tag
}

// ── Card key derivation ───────────────────────────────────────────────────────

/**
 * Derives a 16-byte AES-128 key for DESFire card operations.
 *
 * Role values:
 *   0x00 — reserved (PICC master, not used in v1)
 *   0x01 — app master key
 *   0x02 — app read key
 *
 * Empty HKDF salt is intentional: the UID is already mixed into IKM,
 * providing sufficient domain separation per card. Keep this stable.
 */
export function deriveCardKey(
  machineSecret: Buffer,
  uid: Buffer,              // 4, 7, or 10 bytes — no fixed-length assumption
  role: 0x00 | 0x01 | 0x02
): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.concat([machineSecret, uid]),
      Buffer.alloc(0),
      Buffer.from([0x50, 0x57, 0x4b, role]),  // "PWK" + role byte
      16
    )
  );
}

// ── Entry key derivation ──────────────────────────────────────────────────────

/**
 * Derives a 32-byte AES-256 key for encrypting a single vault entry.
 *
 * Using the entry UUID as the HKDF salt gives each entry an independent key.
 * Changing one entry's encryption does not affect any other entry.
 *
 * cardSecret must be zeroized by the caller immediately after this returns.
 */
export function deriveEntryKey(
  cardSecret: Buffer,     // 16 B — from card File 00
  machineSecret: Buffer,  // 32 B — from OS secure storage
  entryId: string         // UUID v4
): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.concat([cardSecret, machineSecret]),
      Buffer.from(entryId, 'utf8'),
      Buffer.from('pwmgr-entry-v1'),
      32
    )
  );
}

// ── AES-256-GCM encrypt / decrypt ────────────────────────────────────────────

/**
 * Encrypts an EntryPayload with AES-256-GCM.
 * A fresh random 12-byte nonce is generated for every call — never reused.
 */
export function encryptEntry(key: Buffer, payload: EntryPayload): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/**
 * Decrypts an AES-256-GCM blob.
 * Throws if the auth tag does not match (tampered ciphertext or wrong key).
 * The caller is responsible for zeroizing the key buffer after this returns.
 */
export function decryptEntry(
  key: Buffer,
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer
): EntryPayload {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const json = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(json) as EntryPayload;
}

// ── Memory hygiene ────────────────────────────────────────────────────────────

/**
 * Overwrites a Buffer with zeroes so the secret cannot be read from
 * deallocated heap memory. Call this immediately after the Buffer is done.
 */
export function zeroizeBuffer(buf: Buffer): void {
  buf.fill(0);
}
