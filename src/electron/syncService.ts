import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyRemoteDelete,
  applyRemoteUpsert,
  clearOutbox,
  getEntryRow,
  getSyncStateValue,
  listOutbox,
  seedOutboxFromEntries,
  setSyncStateValue,
  SyncEntryRow,
} from './vault.js';

const SYNC_CONFIG_FILE = 'sync-config.json';
const SYNC_SESSION_FILE = 'sync-session.bin';
const CURSOR_KEY = 'sync_cursor';
const LAST_SYNC_AT_KEY = 'sync_last_at';
const LAST_SYNC_ATTEMPT_AT_KEY = 'sync_last_attempt_at';
const LAST_SYNC_ERROR_KEY = 'sync_last_error';
const INITIAL_SEED_DONE_KEY = 'sync_initial_seed_done';

let activeSyncRun: Promise<{ push: SyncPushResult; pull: SyncPullResult }> | null = null;

interface SyncConfig {
  baseUrl: string;
  username: string;
  deviceName: string;
}

interface SyncSession {
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

interface SyncPushResponse {
  applied: string[];
  skipped: Array<{ itemId: string; reason: string }>;
  cursor: number;
}

interface SyncPullChange {
  seq: number;
  itemId: string;
  label: string;
  url: string;
  category: string;
  createdAt: number;
  updatedAt: number;
  ciphertext: string | null;
  iv: string | null;
  authTag: string | null;
  deleted: boolean;
}

interface SyncPullResponse {
  cursor: number;
  nextCursor: number;
  hasMore: boolean;
  changes: SyncPullChange[];
}

interface SyncKeyEnvelopeResponse {
  envelope: SyncKeyEnvelope | null;
}

interface TokenResponse {
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export interface SyncStatus {
  configured: boolean;
  loggedIn: boolean;
  baseUrl?: string;
  username?: string;
  deviceName?: string;
  cursor: number;
  lastSyncAt?: number;
  lastSyncAttemptAt?: number;
  lastSyncError?: string;
}

export interface SyncPushResult {
  sent: number;
  applied: number;
  skipped: number;
  cursor: number;
}

export interface SyncPullResult {
  received: number;
  applied: number;
  deleted: number;
  cursor: number;
  hasMore: boolean;
}

export interface SyncKeyEnvelope {
  keyVersion: number;
  kdf: 'scrypt-v1';
  kdfParams: {
    N: number;
    r: number;
    p: number;
    dkLen: number;
  };
  salt: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
  updatedAt?: string;
}

function configPath(): string {
  return path.join(app.getPath('userData'), SYNC_CONFIG_FILE);
}

function sessionPath(): string {
  return path.join(app.getPath('userData'), SYNC_SESSION_FILE);
}

function getDefaultDeviceName(): string {
  const host = os.hostname().trim() || 'device';
  return `${host}-${process.platform}`;
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Sync URL must use http or https');
  }
  const trimmedPath = url.pathname.endsWith('/') && url.pathname !== '/'
    ? url.pathname.slice(0, -1)
    : url.pathname;
  url.pathname = trimmedPath;
  return url.toString().replace(/\/$/, '');
}

function ensureSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage unavailable: cannot store sync session securely');
  }
}

function readConfig(): SyncConfig | null {
  const file = configPath();
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<SyncConfig>;
  if (!parsed.baseUrl || !parsed.username) return null;
  return {
    baseUrl: normalizeBaseUrl(parsed.baseUrl),
    username: parsed.username,
    deviceName: parsed.deviceName && parsed.deviceName.trim().length > 0
      ? parsed.deviceName.trim()
      : getDefaultDeviceName(),
  };
}

function writeConfig(config: SyncConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}

function clearConfig(): void {
  const file = configPath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function readSession(): SyncSession | null {
  const file = sessionPath();
  if (!fs.existsSync(file)) return null;

  ensureSecureStorageAvailable();
  const encrypted = fs.readFileSync(file);
  const decrypted = safeStorage.decryptString(encrypted);
  const parsed = JSON.parse(decrypted) as Partial<SyncSession>;
  if (
    !parsed.userId ||
    !parsed.deviceId ||
    !parsed.accessToken ||
    !parsed.refreshToken ||
    !parsed.refreshExpiresAt
  ) {
    return null;
  }
  return parsed as SyncSession;
}

function writeSession(session: SyncSession): void {
  ensureSecureStorageAvailable();
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  fs.writeFileSync(sessionPath(), encrypted);
}

function clearSession(): void {
  const file = sessionPath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function getCursor(): number {
  const value = getSyncStateValue(CURSOR_KEY);
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function setCursor(cursor: number): void {
  setSyncStateValue(CURSOR_KEY, String(Math.max(0, Math.trunc(cursor))));
}

function getOptionalTimestampState(key: string): number | undefined {
  const value = getSyncStateValue(key);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

function getOptionalTextState(key: string): string | undefined {
  const value = getSyncStateValue(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function recordSyncAttempt(): void {
  setSyncStateValue(LAST_SYNC_ATTEMPT_AT_KEY, String(Date.now()));
}

function recordSyncSuccess(): void {
  setSyncStateValue(LAST_SYNC_AT_KEY, String(Date.now()));
  setSyncStateValue(LAST_SYNC_ERROR_KEY, '');
}

function recordSyncError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  setSyncStateValue(LAST_SYNC_ERROR_KEY, message);
}

function clearSyncTelemetry(): void {
  setCursor(0);
  setSyncStateValue(LAST_SYNC_AT_KEY, '');
  setSyncStateValue(LAST_SYNC_ATTEMPT_AT_KEY, '');
  setSyncStateValue(LAST_SYNC_ERROR_KEY, '');
  setSyncStateValue(INITIAL_SEED_DONE_KEY, '');
}

function isInitialSeedDone(): boolean {
  return getSyncStateValue(INITIAL_SEED_DONE_KEY) === '1';
}

function markInitialSeedDone(): void {
  setSyncStateValue(INITIAL_SEED_DONE_KEY, '1');
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length === 0) return {} as T;
  return JSON.parse(text) as T;
}

async function throwApiError(response: Response): Promise<never> {
  let details = response.statusText;
  try {
    const parsed = await parseJsonResponse<{ error?: string }>(response);
    if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
      details = parsed.error;
    }
  } catch {
    // Fall back to status text.
  }
  throw new Error(`Sync API ${response.status}: ${details}`);
}

async function requestRaw(
  config: SyncConfig,
  inputPath: string,
  init: RequestInit = {},
  session: SyncSession | null = null
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type') && init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (session) {
    headers.set('authorization', `Bearer ${session.accessToken}`);
  }

  return fetch(`${config.baseUrl}${inputPath}`, {
    ...init,
    headers,
  });
}

async function refreshSession(config: SyncConfig, current: SyncSession): Promise<SyncSession> {
  const response = await requestRaw(config, '/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    throw await throwApiError(response);
  }

  const refreshed = await parseJsonResponse<TokenResponse>(response);
  const next: SyncSession = {
    userId: refreshed.userId,
    deviceId: refreshed.deviceId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    refreshExpiresAt: refreshed.refreshExpiresAt,
  };
  writeSession(next);
  return next;
}

async function requestAuthedJson<T>(
  config: SyncConfig,
  inputPath: string,
  init: RequestInit = {}
): Promise<T> {
  let session = readSession();
  if (!session) throw new Error('Not logged in to sync server');

  let response = await requestRaw(config, inputPath, init, session);
  if (response.status === 401) {
    session = await refreshSession(config, session);
    response = await requestRaw(config, inputPath, init, session);
  }

  if (!response.ok) throw await throwApiError(response);
  return parseJsonResponse<T>(response);
}

function requireConfig(): SyncConfig {
  const config = readConfig();
  if (!config) throw new Error('Sync config missing. Call sync:setConfig first.');
  return config;
}

function makeStatus(config: SyncConfig | null, session: SyncSession | null): SyncStatus {
  return {
    configured: config !== null,
    loggedIn: session !== null,
    baseUrl: config?.baseUrl,
    username: config?.username,
    deviceName: config?.deviceName,
    cursor: getCursor(),
    lastSyncAt: getOptionalTimestampState(LAST_SYNC_AT_KEY),
    lastSyncAttemptAt: getOptionalTimestampState(LAST_SYNC_ATTEMPT_AT_KEY),
    lastSyncError: getOptionalTextState(LAST_SYNC_ERROR_KEY),
  };
}

export function getSyncStatus(): SyncStatus {
  return makeStatus(readConfig(), readSession());
}

export function setSyncConfig(input: { baseUrl: string; username: string; deviceName?: string }): SyncStatus {
  const config: SyncConfig = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    username: input.username.trim(),
    deviceName: input.deviceName && input.deviceName.trim().length > 0
      ? input.deviceName.trim()
      : getDefaultDeviceName(),
  };
  if (config.username.length < 3) throw new Error('Username must be at least 3 characters');
  writeConfig(config);
  return makeStatus(config, readSession());
}

export function clearSyncConfigAndSession(): SyncStatus {
  clearSession();
  clearConfig();
  clearSyncTelemetry();
  return makeStatus(null, null);
}

export async function bootstrapSync(password: string, bootstrapToken: string): Promise<SyncStatus> {
  const config = requireConfig();
  const response = await requestRaw(config, '/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'x-bootstrap-token': bootstrapToken },
    body: JSON.stringify({
      username: config.username,
      password,
      deviceName: config.deviceName,
    }),
  });
  if (!response.ok) throw await throwApiError(response);
  const payload = await parseJsonResponse<TokenResponse>(response);
  writeSession({
    userId: payload.userId,
    deviceId: payload.deviceId,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    refreshExpiresAt: payload.refreshExpiresAt,
  });
  return makeStatus(config, readSession());
}

export async function loginSync(password: string): Promise<SyncStatus> {
  const config = requireConfig();
  const response = await requestRaw(config, '/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: config.username,
      password,
      deviceName: config.deviceName,
    }),
  });
  if (!response.ok) throw await throwApiError(response);
  const payload = await parseJsonResponse<TokenResponse>(response);
  writeSession({
    userId: payload.userId,
    deviceId: payload.deviceId,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    refreshExpiresAt: payload.refreshExpiresAt,
  });
  return makeStatus(config, readSession());
}

export async function logoutSync(): Promise<SyncStatus> {
  const config = readConfig();
  const session = readSession();

  if (config && session) {
    try {
      await requestRaw(config, '/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
    } catch {
      // Best effort logout; clear local session regardless.
    }
  }

  clearSession();
  return makeStatus(config, null);
}

export async function getSyncKeyEnvelope(): Promise<SyncKeyEnvelope | null> {
  const config = requireConfig();
  const response = await requestAuthedJson<SyncKeyEnvelopeResponse>(config, '/v1/keys/envelope');
  return response.envelope ?? null;
}

export async function setSyncKeyEnvelope(envelope: SyncKeyEnvelope): Promise<SyncKeyEnvelope> {
  const config = requireConfig();
  const response = await requestAuthedJson<SyncKeyEnvelopeResponse>(config, '/v1/keys/envelope', {
    method: 'PUT',
    body: JSON.stringify({ envelope }),
  });
  if (!response.envelope) {
    throw new Error('Sync server did not return a key envelope');
  }
  return response.envelope;
}

export async function pushSync(limit = 500): Promise<SyncPushResult> {
  const config = requireConfig();
  let outbox = listOutbox(limit);

  if (outbox.length === 0 && !isInitialSeedDone()) {
    seedOutboxFromEntries();
    markInitialSeedDone();
    outbox = listOutbox(limit);
  }

  if (outbox.length === 0) {
    return { sent: 0, applied: 0, skipped: 0, cursor: getCursor() };
  }

  const staleIds: string[] = [];
  const payloadChanges: Array<Record<string, unknown>> = [];
  const sentIds: string[] = [];

  for (const change of outbox) {
    if (change.deleted) {
      payloadChanges.push({
        itemId: change.id,
        updatedAt: change.updatedAt,
        deleted: true,
      });
      sentIds.push(change.id);
      continue;
    }

    const row = getEntryRow(change.id);
    if (!row) {
      staleIds.push(change.id);
      continue;
    }

    payloadChanges.push({
      itemId: row.id,
      label: row.label,
      url: row.url,
      category: row.category,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ciphertext: row.ciphertext.toString('base64'),
      iv: row.iv.toString('base64'),
      authTag: row.authTag.toString('base64'),
      deleted: false,
    });
    sentIds.push(row.id);
  }

  if (staleIds.length > 0) {
    clearOutbox(staleIds);
  }

  if (payloadChanges.length === 0) {
    return { sent: 0, applied: 0, skipped: staleIds.length, cursor: getCursor() };
  }

  const response = await requestAuthedJson<SyncPushResponse>(config, '/v1/sync/push', {
    method: 'POST',
    body: JSON.stringify({ changes: payloadChanges }),
  });

  clearOutbox(sentIds);
  if (typeof response.cursor === 'number' && response.cursor > getCursor()) {
    setCursor(response.cursor);
  }

  return {
    sent: payloadChanges.length,
    applied: response.applied.length,
    skipped: response.skipped.length + staleIds.length,
    cursor: getCursor(),
  };
}

function toSyncEntryRow(change: SyncPullChange): SyncEntryRow | null {
  if (change.deleted) return null;
  if (!change.ciphertext || !change.iv || !change.authTag) return null;
  return {
    id: change.itemId,
    label: change.label,
    url: change.url,
    category: change.category,
    createdAt: change.createdAt,
    updatedAt: change.updatedAt,
    ciphertext: change.ciphertext,
    iv: change.iv,
    authTag: change.authTag,
    deleted: false,
  };
}

export async function pullSync(limit = 500): Promise<SyncPullResult> {
  const config = requireConfig();
  const cursor = getCursor();
  const response = await requestAuthedJson<SyncPullResponse>(
    config,
    `/v1/sync/pull?cursor=${encodeURIComponent(String(cursor))}&limit=${encodeURIComponent(String(limit))}`
  );

  let appliedCount = 0;
  let deletedCount = 0;
  for (const change of response.changes) {
    if (change.deleted) {
      if (applyRemoteDelete(change.itemId, change.updatedAt)) deletedCount += 1;
      continue;
    }

    const row = toSyncEntryRow(change);
    if (!row) continue;
    if (applyRemoteUpsert(row)) appliedCount += 1;
  }

  if (response.nextCursor > cursor) {
    setCursor(response.nextCursor);
  }

  return {
    received: response.changes.length,
    applied: appliedCount,
    deleted: deletedCount,
    cursor: getCursor(),
    hasMore: response.hasMore,
  };
}

export async function runFullSync(): Promise<{
  push: SyncPushResult;
  pull: SyncPullResult;
}> {
  if (activeSyncRun) return activeSyncRun;

  activeSyncRun = (async () => {
    recordSyncAttempt();
    try {
      const push = await pushSync();
      const pull = await pullSync();
      recordSyncSuccess();
      return { push, pull };
    } catch (error) {
      recordSyncError(error);
      throw error;
    }
  })();

  try {
    return await activeSyncRun;
  } finally {
    activeSyncRun = null;
  }
}
