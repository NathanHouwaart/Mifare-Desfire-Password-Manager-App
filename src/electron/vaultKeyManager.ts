import crypto from 'node:crypto';

import { zeroizeBuffer } from './keyDerivation.js';
import type { SyncKeyEnvelope } from './syncService.js';

const ROOT_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const SALT_BYTES = 16;

const DEFAULT_SCRYPT_PARAMS = {
  N: 32_768,
  r: 8,
  p: 1,
  dkLen: 32,
} as const;

let unlockedVaultRootKey: Buffer | null = null;
let unlockedAt: number | null = null;
let unlockedKeyVersion: number | null = null;

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 10) {
    throw new Error('Passphrase must be at least 10 characters');
  }
}

function assertEnvelopeKdf(envelope: SyncKeyEnvelope): void {
  if (envelope.kdf !== 'scrypt-v1') {
    throw new Error(`Unsupported key-envelope kdf "${envelope.kdf}"`);
  }
}

function assertScryptParams(params: SyncKeyEnvelope['kdfParams']): void {
  const isInt = (value: number) => Number.isInteger(value) && Number.isFinite(value);
  if (!isInt(params.N) || params.N < 16_384 || params.N > 1_048_576) {
    throw new Error('Invalid scrypt N parameter');
  }
  if (!isInt(params.r) || params.r < 1 || params.r > 32) {
    throw new Error('Invalid scrypt r parameter');
  }
  if (!isInt(params.p) || params.p < 1 || params.p > 16) {
    throw new Error('Invalid scrypt p parameter');
  }
  if (!isInt(params.dkLen) || params.dkLen < 32 || params.dkLen > 64) {
    throw new Error('Invalid scrypt dkLen parameter');
  }
}

function toBase64(buf: Buffer): string {
  return buf.toString('base64');
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

function deriveWrapKey(
  passphrase: string,
  salt: Buffer,
  params: SyncKeyEnvelope['kdfParams']
): Buffer {
  return crypto.scryptSync(passphrase, salt, params.dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * 1024 * 1024,
  });
}

export function createVaultRootKeyEnvelope(
  passphrase: string,
  options?: { keyVersion?: number; rootKey?: Buffer }
): { envelope: SyncKeyEnvelope; rootKey: Buffer } {
  assertPassphrase(passphrase);

  const keyVersion = options?.keyVersion ?? 2;
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new Error('Invalid key version');
  }

  const rootKey = options?.rootKey ? Buffer.from(options.rootKey) : crypto.randomBytes(ROOT_KEY_BYTES);
  if (rootKey.length !== ROOT_KEY_BYTES) {
    throw new Error(`rootKey must be ${ROOT_KEY_BYTES} bytes`);
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const params = { ...DEFAULT_SCRYPT_PARAMS };
  const wrapKey = deriveWrapKey(passphrase, salt, params);

  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(rootKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const envelope: SyncKeyEnvelope = {
      keyVersion,
      kdf: 'scrypt-v1',
      kdfParams: params,
      salt: toBase64(salt),
      nonce: toBase64(nonce),
      ciphertext: toBase64(ciphertext),
      authTag: toBase64(authTag),
    };

    return { envelope, rootKey };
  } finally {
    zeroizeBuffer(wrapKey);
  }
}

export function decryptVaultRootKeyFromEnvelope(
  passphrase: string,
  envelope: SyncKeyEnvelope
): Buffer {
  assertPassphrase(passphrase);
  assertEnvelopeKdf(envelope);
  assertScryptParams(envelope.kdfParams);

  const salt = fromBase64(envelope.salt);
  const nonce = fromBase64(envelope.nonce);
  const ciphertext = fromBase64(envelope.ciphertext);
  const authTag = fromBase64(envelope.authTag);

  if (salt.length < SALT_BYTES) throw new Error('Invalid envelope salt');
  if (nonce.length !== NONCE_BYTES) throw new Error('Invalid envelope nonce');
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error('Invalid envelope authTag');
  if (ciphertext.length === 0) throw new Error('Invalid envelope ciphertext');

  const wrapKey = deriveWrapKey(passphrase, salt, envelope.kdfParams);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, nonce);
    decipher.setAuthTag(authTag);
    const rootKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (rootKey.length !== ROOT_KEY_BYTES) {
      zeroizeBuffer(rootKey);
      throw new Error('Envelope decrypted to unexpected key length');
    }
    return rootKey;
  } finally {
    zeroizeBuffer(wrapKey);
  }
}

export function setUnlockedVaultRootKey(rootKey: Buffer, keyVersion: number): void {
  if (rootKey.length !== ROOT_KEY_BYTES) {
    throw new Error(`Unlocked vault key must be ${ROOT_KEY_BYTES} bytes`);
  }

  if (unlockedVaultRootKey) {
    zeroizeBuffer(unlockedVaultRootKey);
  }

  unlockedVaultRootKey = Buffer.from(rootKey);
  unlockedAt = Date.now();
  unlockedKeyVersion = keyVersion;
}

export function getUnlockedVaultRootKey(): Buffer | null {
  if (!unlockedVaultRootKey) return null;
  return Buffer.from(unlockedVaultRootKey);
}

export function clearUnlockedVaultRootKey(): void {
  if (unlockedVaultRootKey) {
    zeroizeBuffer(unlockedVaultRootKey);
    unlockedVaultRootKey = null;
  }
  unlockedAt = null;
  unlockedKeyVersion = null;
}

export function getVaultKeyUnlockState(): {
  hasLocalUnlockedKey: boolean;
  keyVersion?: number;
  unlockedAt?: number;
} {
  return {
    hasLocalUnlockedKey: unlockedVaultRootKey !== null,
    keyVersion: unlockedKeyVersion ?? undefined,
    unlockedAt: unlockedAt ?? undefined,
  };
}

