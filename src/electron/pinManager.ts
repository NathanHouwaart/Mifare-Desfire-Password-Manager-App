import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PIN_STATE_FILE = 'pin-state.bin';
const PIN_LENGTH = 6;
const PIN_REGEX = new RegExp(`^[0-9]{${PIN_LENGTH}}$`);
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MAX_ATTEMPTS = 5;
const LOCK_BASE_MS = 30_000;
const LOCK_MAX_MS = 15 * 60_000;
const RECOVERY_TOKEN_TTL_MS = 2 * 60_000;

type PinVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID'; attemptsRemaining: number }
  | { ok: false; reason: 'LOCKED'; retryAfterMs: number };

type PinChangeResult =
  | { ok: true }
  | { ok: false; reason: 'NO_PIN' }
  | { ok: false; reason: 'INVALID_CURRENT'; attemptsRemaining: number }
  | { ok: false; reason: 'LOCKED'; retryAfterMs: number };

type PinRecoveryStartResult = {
  token: string;
  expiresAt: number;
};

type PinRecoveryCompleteResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_TOKEN' }
  | { ok: false; reason: 'EXPIRED_TOKEN' }
  | { ok: false; reason: 'INVALID_NEW_PIN' };

type PersistedPinStateV1 = {
  version: 1;
  salt: string; // base64
  hash: string; // base64
  kdf: {
    N: number;
    r: number;
    p: number;
    keyLen: number;
  };
  failedAttempts: number;
  lockUntil: number;
  lockLevel: number;
};

let recoveryTokenHash: Buffer | null = null;
let recoveryTokenExpiresAt = 0;

function pinStatePath(): string {
  return path.join(app.getPath('userData'), PIN_STATE_FILE);
}

function ensureSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage is unavailable: cannot use PIN lock');
  }
}

function readState(): PersistedPinStateV1 | null {
  const filePath = pinStatePath();
  if (!fs.existsSync(filePath)) return null;

  ensureSecureStorageAvailable();
  const encrypted = fs.readFileSync(filePath);
  const decrypted = safeStorage.decryptString(encrypted);
  const parsed = JSON.parse(decrypted) as Partial<PersistedPinStateV1>;
  if (parsed.version !== 1) return null;
  if (typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string') return null;
  if (!parsed.kdf || typeof parsed.kdf !== 'object') return null;
  if (
    typeof parsed.kdf.N !== 'number' ||
    typeof parsed.kdf.r !== 'number' ||
    typeof parsed.kdf.p !== 'number' ||
    typeof parsed.kdf.keyLen !== 'number'
  ) {
    return null;
  }

  return {
    version: 1,
    salt: parsed.salt,
    hash: parsed.hash,
    kdf: {
      N: parsed.kdf.N,
      r: parsed.kdf.r,
      p: parsed.kdf.p,
      keyLen: parsed.kdf.keyLen,
    },
    failedAttempts: typeof parsed.failedAttempts === 'number' ? parsed.failedAttempts : 0,
    lockUntil: typeof parsed.lockUntil === 'number' ? parsed.lockUntil : 0,
    lockLevel: typeof parsed.lockLevel === 'number' ? parsed.lockLevel : 0,
  };
}

function writeState(state: PersistedPinStateV1): void {
  ensureSecureStorageAvailable();
  const payload = JSON.stringify(state);
  const encrypted = safeStorage.encryptString(payload);
  fs.writeFileSync(pinStatePath(), encrypted);
}

function derivePinHash(pin: string, salt: Buffer, params: PersistedPinStateV1['kdf']): Buffer {
  return crypto.scryptSync(pin, salt, params.keyLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 64 * 1024 * 1024,
  });
}

function assertPinFormat(pin: string): void {
  if (!PIN_REGEX.test(pin)) {
    throw new Error(`PIN must be exactly ${PIN_LENGTH} digits`);
  }
}

function nextLockDurationMs(lockLevel: number): number {
  return Math.min(LOCK_MAX_MS, LOCK_BASE_MS * (2 ** Math.max(0, lockLevel - 1)));
}

function hashRecoveryToken(token: string): Buffer {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function clearRecoveryToken(): void {
  if (recoveryTokenHash) {
    recoveryTokenHash.fill(0);
    recoveryTokenHash = null;
  }
  recoveryTokenExpiresAt = 0;
}

export function hasPinConfigured(): boolean {
  return readState() !== null;
}

export function setPin(pin: string): void {
  assertPinFormat(pin);

  const salt = crypto.randomBytes(SALT_BYTES);
  const kdf: PersistedPinStateV1['kdf'] = {
    N: 1 << 15,
    r: 8,
    p: 1,
    keyLen: HASH_BYTES,
  };
  const hash = derivePinHash(pin, salt, kdf);

  try {
    writeState({
      version: 1,
      salt: salt.toString('base64'),
      hash: hash.toString('base64'),
      kdf,
      failedAttempts: 0,
      lockUntil: 0,
      lockLevel: 0,
    });
  } finally {
    hash.fill(0);
    salt.fill(0);
  }
}

export function verifyPin(pin: string): PinVerifyResult {
  assertPinFormat(pin);

  const state = readState();
  if (!state) {
    return { ok: false, reason: 'INVALID', attemptsRemaining: 0 };
  }

  const now = Date.now();
  if (state.lockUntil > now) {
    return {
      ok: false,
      reason: 'LOCKED',
      retryAfterMs: state.lockUntil - now,
    };
  }

  const salt = Buffer.from(state.salt, 'base64');
  const expectedHash = Buffer.from(state.hash, 'base64');
  if (expectedHash.length !== state.kdf.keyLen) {
    throw new Error('Stored PIN verifier has invalid hash length');
  }

  const candidateHash = derivePinHash(pin, salt, state.kdf);

  try {
    const isMatch = crypto.timingSafeEqual(candidateHash, expectedHash);
    if (isMatch) {
      if (state.failedAttempts !== 0 || state.lockUntil !== 0 || state.lockLevel !== 0) {
        state.failedAttempts = 0;
        state.lockUntil = 0;
        state.lockLevel = 0;
        writeState(state);
      }
      return { ok: true };
    }

    state.failedAttempts += 1;
    if (state.failedAttempts >= MAX_ATTEMPTS) {
      state.failedAttempts = 0;
      state.lockLevel += 1;
      const durationMs = nextLockDurationMs(state.lockLevel);
      state.lockUntil = now + durationMs;
      writeState(state);
      return { ok: false, reason: 'LOCKED', retryAfterMs: durationMs };
    }

    writeState(state);
    return {
      ok: false,
      reason: 'INVALID',
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - state.failedAttempts),
    };
  } finally {
    candidateHash.fill(0);
    expectedHash.fill(0);
    salt.fill(0);
  }
}

export function changePin(currentPin: string, newPin: string): PinChangeResult {
  assertPinFormat(currentPin);
  assertPinFormat(newPin);

  if (!hasPinConfigured()) {
    return { ok: false, reason: 'NO_PIN' };
  }

  const verifyResult = verifyPin(currentPin);
  if (!verifyResult.ok) {
    if (verifyResult.reason === 'LOCKED') {
      return { ok: false, reason: 'LOCKED', retryAfterMs: verifyResult.retryAfterMs };
    }
    return {
      ok: false,
      reason: 'INVALID_CURRENT',
      attemptsRemaining: verifyResult.attemptsRemaining,
    };
  }

  setPin(newPin);
  return { ok: true };
}

export function startPinRecovery(): PinRecoveryStartResult {
  clearRecoveryToken();

  const token = crypto.randomBytes(32).toString('base64url');
  recoveryTokenHash = hashRecoveryToken(token);
  recoveryTokenExpiresAt = Date.now() + RECOVERY_TOKEN_TTL_MS;
  return {
    token,
    expiresAt: recoveryTokenExpiresAt,
  };
}

export function completePinRecovery(token: string, newPin: string): PinRecoveryCompleteResult {
  if (!PIN_REGEX.test(newPin)) {
    return { ok: false, reason: 'INVALID_NEW_PIN' };
  }

  if (!recoveryTokenHash) {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  if (Date.now() > recoveryTokenExpiresAt) {
    clearRecoveryToken();
    return { ok: false, reason: 'EXPIRED_TOKEN' };
  }

  const candidateHash = hashRecoveryToken(token);
  let isMatch = false;
  try {
    if (candidateHash.length === recoveryTokenHash.length) {
      isMatch = crypto.timingSafeEqual(candidateHash, recoveryTokenHash);
    }
  } finally {
    candidateHash.fill(0);
  }

  if (!isMatch) {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  setPin(newPin);
  clearRecoveryToken();
  return { ok: true };
}

export function resetPin(): void {
  const filePath = pinStatePath();
  if (!fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
}
