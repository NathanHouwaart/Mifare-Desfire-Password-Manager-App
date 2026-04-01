import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, dialog, safeStorage, clipboard, shell, nativeImage } from 'electron'
import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Server } from 'node:net';
import { isDev } from './utils.js';
import { getPreloadPath, getUIPath } from './pathResolver.js';
import { openVault, closeVault, wipeVault } from './vault.js';
import { registerCardHandlers } from './cardHandlers.js';
import { registerVaultHandlers } from './vaultHandlers.js';
import { registerSyncHandlers }  from './syncHandlers.js';
import {
  clearSyncConfigAndSession,
  getSyncSessionDeviceId,
  getSyncStatus,
  loginSync,
  openSyncEventsStream,
  pullSync,
  runFullSync,
} from './syncService.js';
import { clearUnlockedVaultRootKey, getUnlockedVaultRootKey } from './vaultKeyManager.js';
import { startBridgeServer }    from './bridgeServer.js';
import { cancelCardWait } from './nfcCancel.js';
import { registerNativeHost }   from './nativeHostRegistrar.js';
import { hasPinConfigured, setPin, verifyPin, changePin, startPinRecovery, completePinRecovery, resetPin } from './pinManager.js';
import type { NfcCppBinding as NfcCppBindingType } from './bindings.js';
import { registerUpdateManager, type UpdateManagerController } from './updateManager.js';

// Add global error handlers to catch crashes
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});

let mainWindow: BrowserWindow | null = null;
let nfcBinding: NfcCppBindingType | null = null;
let bridgeServer: Server | null = null;
let shutdownInProgress = false;
const LOCKED_ZOOM_FACTOR = 0.8; // roughly equivalent to pressing Ctrl + '-' twice from 100%
const ZOOM_SHORTCUT_KEYS = new Set(['+', '=', '-', '_', '0', 'Add', 'Subtract', 'NumpadAdd', 'NumpadSubtract']);
const AUTO_SYNC_FALLBACK_INTERVAL_MS = 15 * 60 * 1000;
const SYNC_EVENTS_IDLE_WAIT_MS = 10_000;
const SYNC_EVENTS_RETRY_BASE_MS = 3_000;
const SYNC_EVENTS_RETRY_MAX_MS = 60_000;
const SYNC_EVENTS_SYNC_DEBOUNCE_MS = 1_200;
const APP_PROTOCOL_SCHEME = 'securepass';
const WM_DEVICECHANGE = 0x0219;
const DBT_DEVICEARRIVAL = 0x8000;
const DBT_DEVICEREMOVECOMPLETE = 0x8004;
const DBT_DEVNODES_CHANGED = 0x0007;

let autoSyncTimer: NodeJS.Timeout | null = null;
let autoSyncRunning = false;
let autoSyncRerunRequested = false;
let syncEventsLoopAbort: AbortController | null = null;
let syncEventsLoopPromise: Promise<void> | null = null;
let syncEventDebounceTimer: NodeJS.Timeout | null = null;
let lastSyncEventCursorSeen = 0;
let pendingSyncInvite: SyncInvitePayloadDto | null = null;
let hotplugCheckInFlight = false;
let pendingReconnectPort: string | null = null;
let updateManager: UpdateManagerController | null = null;

type UpdateIpcFacade = {
  getStatus: () => AppUpdateStatusDto;
  checkNow: () => Promise<AppUpdateStatusDto>;
  installNow: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

if (process.platform === 'win32') {
  // Keep taskbar grouping/icon tied to our explicit app identity.
  app.setAppUserModelId('com.securepass.app');
}

/**
 * Tracks the port the C++ binding currently has open.
 * Used to give the renderer a success response when it reconnects after
 * an HMR reload without the underlying serial port ever closing.
 */
let connectedPort: string | null = null;
let vaultUnlocked = false;

function isVaultUnlocked(): boolean {
  return vaultUnlocked;
}

function setVaultLocked(): void {
  vaultUnlocked = false;
  cancelCardWait();
}

function setVaultUnlocked(): void {
  vaultUnlocked = true;
}

function normalizeInviteBaseUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const trimmedPath = parsed.pathname.endsWith('/') && parsed.pathname !== '/'
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = trimmedPath;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function parseSyncInviteUrl(url: string): SyncInvitePayloadDto | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APP_PROTOCOL_SCHEME}:`) return null;

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const isInviteRoute =
      host === 'invite' ||
      host === 'sync-invite' ||
      pathname === '/invite' ||
      pathname === '/sync-invite';
    if (!isInviteRoute) return null;

    const serverParam =
      parsed.searchParams.get('server') ??
      parsed.searchParams.get('baseUrl') ??
      parsed.searchParams.get('url');
    if (!serverParam) return null;

    const normalizedBaseUrl = normalizeInviteBaseUrl(serverParam);
    if (!normalizedBaseUrl) return null;

    const username = parsed.searchParams.get('username')?.trim();
    const inviteToken = parsed.searchParams.get('token')?.trim();
    return {
      baseUrl: normalizedBaseUrl,
      username: username && username.length > 0 ? username : undefined,
      inviteToken: inviteToken && inviteToken.length > 0 ? inviteToken : undefined,
    };
  } catch {
    return null;
  }
}

function parseSyncInviteFromArgv(argv: readonly string[]): SyncInvitePayloadDto | null {
  for (const token of argv) {
    if (!token.toLowerCase().startsWith(`${APP_PROTOCOL_SCHEME}://`)) continue;
    const invite = parseSyncInviteUrl(token);
    if (invite) return invite;
  }
  return null;
}

function publishSyncInvite(invite: SyncInvitePayloadDto): void {
  pendingSyncInvite = invite;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('securepass:syncInvite', invite);
}

function registerProtocolClient(): void {
  // Avoid poisoning the user's global protocol association while running in dev.
  // Opt-in if needed via SECUREPASS_REGISTER_PROTOCOL_IN_DEV=1.
  if (isDev() && process.env.SECUREPASS_REGISTER_PROTOCOL_IN_DEV !== '1') {
    console.log(`[invite] Skipping ${APP_PROTOCOL_SCHEME}:// protocol registration in development mode.`);
    return;
  }

  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
      return;
    }
    app.setAsDefaultProtocolClient(APP_PROTOCOL_SCHEME);
  } catch (error) {
    console.warn(`[invite] Failed to register ${APP_PROTOCOL_SCHEME}:// protocol`, error);
  }
}

const startupInvite = parseSyncInviteFromArgv(process.argv);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
const blockedColdStartInvite = Boolean(startupInvite && hasSingleInstanceLock);

if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    const invite = parseSyncInviteFromArgv(argv);
    if (invite) {
      publishSyncInvite(invite);
    }

    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.on('open-url', (event, url) => {
  if (!hasSingleInstanceLock) return;
  // When deep links are restricted to already-running sessions, ignore
  // open-url events before the main window is available.
  if (!mainWindow) return;
  event.preventDefault();
  const invite = parseSyncInviteUrl(url);
  if (!invite) return;
  publishSyncInvite(invite);

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── Machine secret ────────────────────────────────────────────────────────────

/**
 * In-memory handle to the 32-byte machine secret.
 * Loaded from OS secure storage on startup. Never sent to renderer.
 */
let machineSecret: Buffer | null = null;

/**
 * Returns the machine secret. Throws if called before app.ready or when
 * safeStorage is unavailable.
 */
export function getMachineSecret(): Buffer {
  if (!machineSecret) throw new Error('Machine secret not initialised');
  return machineSecret;
}

/**
 * Active crypto root secret used for card auth + entry key derivation.
 * Prefers the unlocked synced root key (portable across devices), and falls
 * back to this device's machine secret for legacy/single-device usage.
 */
export function getCryptoRootSecret(): Buffer {
  const unlocked = getUnlockedVaultRootKey();
  if (unlocked) return unlocked;
  return Buffer.from(getMachineSecret());
}

function initMachineSecret(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fail closed — OS secure storage is mandatory for vault operations.
    // On Linux this means libsecret is not available.
    console.error('[VAULT] safeStorage encryption is not available on this system.');
    app.quit();
    return;
  }

  const secretPath = path.join(app.getPath('userData'), 'machine.secret');

  if (fs.existsSync(secretPath)) {
    // Decrypt and load the existing secret.
    const encrypted = fs.readFileSync(secretPath);
    const decrypted = safeStorage.decryptString(encrypted);
    machineSecret = Buffer.from(decrypted, 'base64');
    console.log('[VAULT] Machine secret loaded from secure storage.');
  } else {
    // First run — generate a new 32-byte secret and persist it.
    const raw = crypto.randomBytes(32);
    const encoded = raw.toString('base64');
    const encrypted = safeStorage.encryptString(encoded);
    fs.writeFileSync(secretPath, encrypted);
    machineSecret = raw;
    console.log('[VAULT] Machine secret generated and stored.');
  }
}

function sendLogToRenderer(level: 'info' | 'warn' | 'error', message: string) {
  const entry: NfcLogEntry = {
    level,
    message,
    timestamp: new Date().toLocaleTimeString('en', { hour12: false }),
  };
  mainWindow?.webContents.send('nfc-log', entry);
}

function nfcLog(level: 'info' | 'warn' | 'error', message: string) {
  console.log(`[NFC-${level.toUpperCase()}] ${message}`);
  sendLogToRenderer(level, message);
}

function getNfcConnectionState(
  reason: NfcConnectionStateDto['reason'] = 'startup',
  message?: string
): NfcConnectionStateDto {
  return {
    connected: connectedPort !== null,
    port: connectedPort,
    reason,
    message,
  };
}

function publishNfcConnectionState(
  reason: NfcConnectionStateDto['reason'],
  message?: string
): void {
  const payload = getNfcConnectionState(reason, message);
  mainWindow?.webContents.send('nfc:connectionChanged', payload);
}

function normalizePortIdentifier(port: string): string {
  return process.platform === 'win32' ? port.toUpperCase() : port;
}

function readWParamCode(wParam: Buffer): number {
  // WM_DEVICECHANGE notification IDs fit in the low DWORD.
  if (!Buffer.isBuffer(wParam) || wParam.length < 4) return 0;
  return wParam.readUInt32LE(0);
}

async function handleHotplugDeviceChange(trigger: string): Promise<void> {
  if (hotplugCheckInFlight) return;
  if (!connectedPort && !pendingReconnectPort) return;
  hotplugCheckInFlight = true;
  try {
    const ports = await SerialPort.list();
    const hasPort = (port: string): boolean => {
      const portId = normalizePortIdentifier(port);
      return ports.some((entry) => normalizePortIdentifier(entry.path) === portId);
    };

    // 1) Handle unplug while connected.
    if (connectedPort) {
      const openPort = connectedPort;
      const stillPresent = hasPort(openPort);
      if (!stillPresent && connectedPort === openPort) {
        connectedPort = null;
        pendingReconnectPort = openPort;
        nfcLog('warn', `Reader disconnected from ${openPort} (${trigger})`);
        publishNfcConnectionState('device-unplugged', `Reader unplugged: ${openPort}`);

        if (nfcBinding) {
          try {
            await nfcBinding.disconnect();
          } catch {
            // Best effort: reader is already gone.
          }
        }
      }
    }

    // 2) Handle replug after unplug.
    if (!connectedPort && pendingReconnectPort && nfcBinding) {
      const candidatePort = pendingReconnectPort;
      if (!hasPort(candidatePort)) return;

      try {
        const result = await nfcBinding.connect(candidatePort);
        connectedPort = candidatePort;
        pendingReconnectPort = null;
        nfcLog('info', `Reader reconnected on ${candidatePort} (${trigger})`);
        nfcLog('info', result);
        publishNfcConnectionState('device-replugged', `Reconnected to ${candidatePort}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Keep pendingReconnectPort so the next device-change event can retry.
        nfcLog('warn', `Auto-reconnect failed for ${candidatePort}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    nfcLog('warn', `Hotplug verification failed: ${msg}`);
  } finally {
    hotplugCheckInFlight = false;
  }
}

function installWindowsDeviceChangeHook(win: BrowserWindow): void {
  if (process.platform !== 'win32') return;

  win.hookWindowMessage(WM_DEVICECHANGE, (wParam) => {
    const code = readWParamCode(wParam);
    if (
      code !== DBT_DEVICEARRIVAL &&
      code !== DBT_DEVICEREMOVECOMPLETE &&
      code !== DBT_DEVNODES_CHANGED
    ) {
      return;
    }
    void handleHotplugDeviceChange(`WM_DEVICECHANGE(0x${code.toString(16)})`);
  });
}

type BackgroundSyncReason = 'startup' | 'interval' | 'sse' | 'queued';
type ParsedSyncStreamEvent = {
  cursor?: number;
  sourceDeviceId?: string | null;
};

function waitWithAbort(signal: AbortSignal, timeoutMs: number): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function emitSyncAppliedToRenderer(result: SyncRunResultDto, reason: BackgroundSyncReason): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('sync:applied', {
    reason,
    at: Date.now(),
    push: result.push,
    pull: result.pull,
  } satisfies SyncAppliedEventDto);
}

function scheduleSyncFromRemoteEvent(): void {
  if (syncEventDebounceTimer) {
    clearTimeout(syncEventDebounceTimer);
  }
  syncEventDebounceTimer = setTimeout(() => {
    syncEventDebounceTimer = null;
    void runBackgroundSync('sse');
  }, SYNC_EVENTS_SYNC_DEBOUNCE_MS);
}

function parseSyncStreamEventPayload(raw: string): ParsedSyncStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;

    const payload: ParsedSyncStreamEvent = {};
    if (typeof obj.cursor === 'number' && Number.isFinite(obj.cursor)) {
      payload.cursor = Math.max(0, Math.trunc(obj.cursor));
    }
    if (typeof obj.sourceDeviceId === 'string') {
      payload.sourceDeviceId = obj.sourceDeviceId;
    } else if (obj.sourceDeviceId === null) {
      payload.sourceDeviceId = null;
    }
    return payload;
  } catch {
    return null;
  }
}

function handleSyncStreamEvent(eventName: string, data: string): void {
  if (eventName !== 'sync_change' && eventName !== 'hello') return;
  const payload = parseSyncStreamEventPayload(data);
  if (!payload) return;

  if (eventName === 'sync_change') {
    const localDeviceId = getSyncSessionDeviceId();
    if (localDeviceId && payload.sourceDeviceId === localDeviceId) {
      return;
    }
  }

  if (typeof payload.cursor === 'number') {
    if (payload.cursor <= lastSyncEventCursorSeen) return;
    lastSyncEventCursorSeen = payload.cursor;
  }

  const status = getSyncStatus();
  if (!status.configured || !status.loggedIn) return;

  // Catch up quickly if the stream reports a newer cursor than local state,
  // and coalesce bursts into one sync run.
  if (typeof payload.cursor === 'number' && payload.cursor <= status.cursor) return;
  if (eventName === 'sync_change') {
    const cursorLabel = typeof payload.cursor === 'number' ? String(payload.cursor) : 'unknown';
    nfcLog('info', `[sync-events] remote change detected (cursor=${cursorLabel}); scheduling sync`);
  }
  scheduleSyncFromRemoteEvent();
}

async function consumeSyncEventStream(signal: AbortSignal): Promise<void> {
  const response = await openSyncEventsStream(signal);
  const body = response.body;
  if (!body) {
    throw new Error('Sync events stream did not provide a response body');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let currentEventName = 'message';
  let currentDataLines: string[] = [];

  const flushEvent = () => {
    if (currentDataLines.length === 0) {
      currentEventName = 'message';
      return;
    }
    handleSyncStreamEvent(currentEventName, currentDataLines.join('\n'));
    currentEventName = 'message';
    currentDataLines = [];
  };

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    while (true) {
      const lineBreakIndex = buffered.indexOf('\n');
      if (lineBreakIndex < 0) break;

      let line = buffered.slice(0, lineBreakIndex);
      buffered = buffered.slice(lineBreakIndex + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      if (line.length === 0) {
        flushEvent();
        continue;
      }
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        currentEventName = line.slice('event:'.length).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        currentDataLines.push(line.slice('data:'.length).trimStart());
      }
    }
  }

  const trailing = decoder.decode();
  if (trailing.length > 0) {
    buffered += trailing;
  }
  if (buffered.trim().length > 0 && buffered.startsWith('data:')) {
    currentDataLines.push(buffered.slice('data:'.length).trimStart());
  }
  flushEvent();
}

async function runSyncEventsLoop(signal: AbortSignal): Promise<void> {
  let retryDelayMs = SYNC_EVENTS_RETRY_BASE_MS;

  while (!signal.aborted) {
    const status = getSyncStatus();
    if (!status.configured || !status.loggedIn) {
      lastSyncEventCursorSeen = 0;
      await waitWithAbort(signal, SYNC_EVENTS_IDLE_WAIT_MS);
      continue;
    }

    try {
      nfcLog('info', '[sync-events] stream connected');
      await consumeSyncEventStream(signal);
      if (signal.aborted) break;
      nfcLog('warn', '[sync-events] stream ended; reconnecting');
      await waitWithAbort(signal, SYNC_EVENTS_RETRY_BASE_MS);
      retryDelayMs = SYNC_EVENTS_RETRY_BASE_MS;
    } catch (err) {
      if (signal.aborted) break;
      const message = err instanceof Error ? err.message : String(err);
      nfcLog('warn', `[sync-events] stream disconnected: ${message}`);
      const endpointMissing = /sync api 404/i.test(message.toLowerCase());
      if (endpointMissing) {
        await waitWithAbort(signal, AUTO_SYNC_FALLBACK_INTERVAL_MS);
        retryDelayMs = SYNC_EVENTS_RETRY_BASE_MS;
      } else {
        await waitWithAbort(signal, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, SYNC_EVENTS_RETRY_MAX_MS);
      }
    }
  }
}

function startSyncEventsLoop(): void {
  if (syncEventsLoopPromise) return;

  const controller = new AbortController();
  syncEventsLoopAbort = controller;
  syncEventsLoopPromise = runSyncEventsLoop(controller.signal)
    .catch((err) => {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      nfcLog('warn', `[sync-events] loop crashed: ${message}`);
    })
    .finally(() => {
      if (syncEventsLoopAbort === controller) {
        syncEventsLoopAbort = null;
      }
      syncEventsLoopPromise = null;
    });
}

function stopSyncEventsLoop(): void {
  if (syncEventDebounceTimer) {
    clearTimeout(syncEventDebounceTimer);
    syncEventDebounceTimer = null;
  }
  if (!syncEventsLoopAbort) return;
  syncEventsLoopAbort.abort();
  syncEventsLoopAbort = null;
}

async function runBackgroundSync(reason: BackgroundSyncReason): Promise<void> {
  if (autoSyncRunning) {
    autoSyncRerunRequested = true;
    return;
  }

  const status = getSyncStatus();
  if (!status.configured || !status.loggedIn) return;

  autoSyncRunning = true;
  try {
    const result: SyncRunResultDto = reason === 'sse'
      ? {
          push: {
            sent: 0,
            applied: 0,
            skipped: 0,
            // Pull updates the shared cursor state; mirror that value for the synthetic push slot.
            cursor: 0,
          },
          pull: await pullSync(),
        }
      : await runFullSync();
    if (reason === 'sse') {
      result.push.cursor = result.pull.cursor;
    }
    const didWork = result.push.sent > 0 || result.pull.received > 0;
    if (didWork) {
      nfcLog(
        'info',
        `[sync] ${reason}: push sent=${result.push.sent}, applied=${result.push.applied}; ` +
        `pull received=${result.pull.received}, applied=${result.pull.applied}, deleted=${result.pull.deleted}`
      );
      emitSyncAppliedToRenderer(result, reason);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    nfcLog('warn', `[sync] ${reason} failed: ${msg}`);
  } finally {
    autoSyncRunning = false;
    if (autoSyncRerunRequested) {
      autoSyncRerunRequested = false;
      void runBackgroundSync('queued');
    }
  }
}

function startBackgroundSyncLoop(): void {
  if (autoSyncTimer) return;
  void runBackgroundSync('startup');
  startSyncEventsLoop();
  autoSyncTimer = setInterval(() => {
    void runBackgroundSync('interval');
  }, AUTO_SYNC_FALLBACK_INTERVAL_MS);
}

function stopBackgroundSyncLoop(): void {
  stopSyncEventsLoop();
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

function applyLockedZoom(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  win.webContents.setZoomFactor(LOCKED_ZOOM_FACTOR);
}

function isZoomInput(input: Electron.Input): boolean {
  if (!(input.control || input.meta)) return false;
  if (input.type === 'mouseWheel') return true; // Ctrl/Cmd + wheel zoom
  return ZOOM_SHORTCUT_KEYS.has(input.key);
}

function resolveBundledDirCandidates(dirName: string): string[] {
  const appPath = app.getAppPath();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ?? path.resolve(appPath, '..');

  return Array.from(new Set([
    path.join(resourcesPath, dirName),
    path.join(resourcesPath, 'app.asar.unpacked', dirName),
    path.resolve(appPath, dirName),
    path.resolve(appPath, '..', dirName),
    path.resolve(process.cwd(), dirName),
  ]));
}

function firstExistingDir(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore invalid candidates and continue searching.
    }
  }
  return null;
}

async function openFolderWithFallback(dir: string): Promise<string | null> {
  const timeoutToken = '__OPEN_PATH_TIMEOUT__';
  const timeoutMs = 3500;

  const openPathPromise = shell.openPath(dir)
    .then((result) => result ?? '')
    .catch((err: unknown) => (err instanceof Error ? err.message : String(err)));

  const result = await Promise.race<string>([
    openPathPromise,
    new Promise<string>((resolve) => setTimeout(() => resolve(timeoutToken), timeoutMs)),
  ]);

  if (result !== timeoutToken) {
    return result.length === 0 ? null : result;
  }

  if (process.platform === 'linux') {
    try {
      const child = spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' });
      child.unref();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Timed out waiting for shell.openPath and xdg-open failed: ${msg}`;
    }
  }

  return `Timed out waiting for shell.openPath after ${timeoutMs}ms`;
}

async function closeBridgeServer(
  server: Server,
  timeoutMs = 1000
): Promise<void> {
  if (!server.listening) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timer = setTimeout(done, timeoutMs);
    server.close(() => {
      clearTimeout(timer);
      done();
    });
  });
}

function parseUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  const asText = String(error ?? '');
  return asText.trim().length > 0 ? asText.trim() : 'Unknown updater error';
}

function createUnavailableUpdateFacade(reason: string): UpdateIpcFacade {
  const message = reason.trim().length > 0 ? reason : 'Updater is unavailable in this build.';
  return {
    getStatus: () => ({
      state: 'error',
      currentVersion: app.getVersion(),
      error: message,
      lastCheckedAt: Date.now(),
    }),
    checkNow: async () => ({
      state: 'error',
      currentVersion: app.getVersion(),
      error: message,
      lastCheckedAt: Date.now(),
    }),
    installNow: async () => ({
      ok: false as const,
      error: message,
    }),
  };
}

let updateIpcFacade: UpdateIpcFacade = createUnavailableUpdateFacade('Updater is initializing...');

function registerDeterministicUpdateIpcHandlers(): void {
  ipcMain.removeHandler('update:getStatus');
  ipcMain.removeHandler('update:checkNow');
  ipcMain.removeHandler('update:installNow');

  ipcMain.handle('update:getStatus', async () => updateIpcFacade.getStatus());
  ipcMain.handle('update:checkNow', async () => updateIpcFacade.checkNow());
  ipcMain.handle('update:installNow', async () => updateIpcFacade.installNow());
}

registerDeterministicUpdateIpcHandlers();

ipcMain.handle('sync:consumeInvite', (): SyncInvitePayloadDto | null => {
  const next = pendingSyncInvite;
  pendingSyncInvite = null;
  return next;
});

app.on('ready', async () => {
  if (!hasSingleInstanceLock) return;

  if (blockedColdStartInvite) {
    console.log('[invite] Invite link received while app is not running.');
    await dialog.showMessageBox({
      type: 'info',
      title: 'SecurePass NFC Is Not Running',
      message: 'SecurePass NFC must already be open to use this invite link.',
      detail: 'Open SecurePass NFC first, then open the invite link again.',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    });
    app.exit(0);
    return;
  }

  console.log('[MAIN.TS] App ready event fired');
  registerProtocolClient();

  // Initialise machine secret (fail-closed if safeStorage unavailable).
  initMachineSecret();

  // Open vault DB and run any pending migrations.
  openVault();

  const { NfcCppBinding } = await import('./bindings.js');
  nfcBinding = new NfcCppBinding();

  // Register card and vault IPC handlers now that nfcBinding exists.
  registerCardHandlers(nfcBinding, nfcLog);
  registerVaultHandlers(nfcBinding, nfcLog, { isVaultUnlocked });
  registerSyncHandlers(nfcLog, { getMachineSecret });
  startBackgroundSyncLoop();

  // Start the named-pipe bridge that feeds the browser extension.
  bridgeServer = startBridgeServer(nfcBinding, nfcLog, { isVaultUnlocked });

  // Keep the native messaging host registration up-to-date so the browser
  // extension always points to the correct install location.
  registerNativeHost((msg) => nfcLog('info', msg));

  ipcMain.handle('app:lock', () => {
    setVaultLocked();
    return { ok: true as const };
  });
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    setImmediate(() => app.exit(0));
    return { ok: true as const };
  });

  // Allow the renderer to abort any in-progress card-wait polling loop.
  ipcMain.handle('nfc:cancel', () => { cancelCardWait(); });

  // App-lock PIN handlers (main-process only; renderer never sees verifier data).
  ipcMain.handle('pin:has', () => hasPinConfigured());
  ipcMain.handle('pin:set', (_event: IpcMainInvokeEvent, pin: string) => {
    if (hasPinConfigured()) {
      throw new Error('PIN is already configured. Use Change PIN or PIN recovery.');
    }
    setPin(pin);
    setVaultUnlocked();
    return { ok: true as const };
  });
  ipcMain.handle('pin:verify', (_event: IpcMainInvokeEvent, pin: string) => {
    const result = verifyPin(pin);
    if (result.ok) {
      setVaultUnlocked();
    }
    return result;
  });
  ipcMain.handle('pin:change', (_event: IpcMainInvokeEvent, currentPin: string, newPin: string) =>
    changePin(currentPin, newPin)
  );
  ipcMain.handle('pin:recovery:capabilities', () => {
    const syncStatus = getSyncStatus();
    return {
      accountRecoveryAvailable: syncStatus.configured,
      destructiveResetAvailable: true as const,
    };
  });
  ipcMain.handle('pin:recovery:start', async (_event: IpcMainInvokeEvent, payload?: PinRecoveryStartDto) => {
    if (!hasPinConfigured()) {
      return { ok: false as const, reason: 'NO_PIN' as const };
    }

    const syncStatus = getSyncStatus();
    const syncRequired = syncStatus.configured;
    if (!syncRequired) {
      return {
        ok: false as const,
        reason: 'NO_SECURE_RECOVERY' as const,
        message: 'Secure account recovery is unavailable on this device. Use destructive reset to continue.',
      };
    }

    const password = typeof payload?.password === 'string' ? payload.password.trim() : '';
    const mfaCode = typeof payload?.mfaCode === 'string' ? payload.mfaCode.trim() : undefined;
    if (!password) {
      return { ok: false as const, reason: 'SYNC_PASSWORD_REQUIRED' as const };
    }

    try {
      await loginSync(password, mfaCode && mfaCode.length > 0 ? mfaCode : undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lowered = message.toLowerCase();
      const code = typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
      if (code === 'MFA_REQUIRED') {
        return { ok: false as const, reason: 'MFA_REQUIRED' as const };
      }
      if (code === 'INVALID_MFA_CODE') {
        return { ok: false as const, reason: 'INVALID_MFA_CODE' as const };
      }
      if (
        !mfaCode &&
        (lowered.includes('mfa_required') || lowered.includes('mfa code required') || lowered.includes('sync api 400: bad request'))
      ) {
        return { ok: false as const, reason: 'MFA_REQUIRED' as const };
      }
      if (lowered.includes('invalid_mfa_code') || lowered.includes('invalid mfa code')) {
        return { ok: false as const, reason: 'INVALID_MFA_CODE' as const };
      }
      return { ok: false as const, reason: 'SYNC_AUTH_FAILED' as const, message };
    }

    const recovery = startPinRecovery();
    return {
      ok: true as const,
      token: recovery.token,
      expiresAt: recovery.expiresAt,
      syncRequired,
    };
  });
  ipcMain.handle('pin:recovery:destructiveReset', async () => {
    setVaultLocked();
    clearUnlockedVaultRootKey();
    cancelCardWait();
    clearSyncConfigAndSession();
    wipeVault();
    resetPin();
    return { ok: true as const };
  });
  ipcMain.handle('pin:recovery:complete', (_event: IpcMainInvokeEvent, payload: PinRecoveryCompleteDto) => {
    const token = typeof payload?.token === 'string' ? payload.token : '';
    const newPin = typeof payload?.newPin === 'string' ? payload.newPin : '';
    const result = completePinRecovery(token, newPin);
    if (result.ok) {
      setVaultUnlocked();
    }
    return result;
  });

  // Clear the system clipboard from the main process (no focus restriction).
  ipcMain.handle('clipboard:clear', () => { clipboard.writeText(''); });

  // Read the current clipboard text from the main process (no focus restriction).
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  // Browser extension helpers
  ipcMain.handle('extension:open-folder', async () => {
    try {
      const candidates = resolveBundledDirCandidates('extension');
      const extDir = firstExistingDir(candidates);
      if (!extDir) {
        return { ok: false, error: `Extension folder not found. Checked: ${candidates.join(', ')}` };
      }

      const openError = await openFolderWithFallback(extDir);
      if (openError) {
        return { ok: false, error: `Failed to open extension folder: ${openError}`, path: extDir };
      }

      return { ok: true, path: extDir };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('extension:reload-registration', () => {
    try {
      const result = registerNativeHost((msg) => nfcLog('info', msg));
      return result.ok
        ? { ok: true }
        : { ok: false, error: result.error };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // Forward all C++ library logs to the in-app debug terminal
  nfcBinding.setLogCallback((level: string, message: string) => {
    const l: 'info' | 'warn' | 'error' =
      level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'info';
    sendLogToRenderer(l, message);
  });

  const windowIconCandidates = resolveBundledDirCandidates('assets')
    .map((assetsDir) => path.join(assetsDir, 'favicon.ico'));
  const windowIcon = windowIconCandidates.find((candidate) => fs.existsSync(candidate));

  // Create nativeImage for the window icon if available
  let iconImg: ReturnType<typeof nativeImage.createFromPath> | undefined = undefined;
  try {
    if (windowIcon) {
      const candidate = nativeImage.createFromPath(windowIcon);
      if (!candidate.isEmpty()) iconImg = candidate;
    } else {
      console.warn('Window icon not found. Checked:', windowIconCandidates.join(', '));
    }
  } catch (err) {
    console.warn('Could not load window icon:', err);
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'SecurePass NFC',
    icon: iconImg,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      zoomFactor: LOCKED_ZOOM_FACTOR,
    }
  });
  installWindowsDeviceChangeHook(mainWindow);

  // Disable pinch/gesture zoom and lock page zoom to a constant value.
  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch((err) => {
    console.warn('Could not set visual zoom limits:', err);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!isZoomInput(input)) return;
    event.preventDefault();
    applyLockedZoom(mainWindow);
  });

  // Re-apply on lifecycle events that can indirectly alter effective zoom.
  mainWindow.webContents.on('did-finish-load', () => {
    applyLockedZoom(mainWindow);
    publishNfcConnectionState('startup');
    updateManager?.publishCurrentStatus();
    if (pendingSyncInvite) {
      mainWindow?.webContents.send('securepass:syncInvite', pendingSyncInvite);
    }
  });
  mainWindow.webContents.on('did-navigate-in-page', () => applyLockedZoom(mainWindow));
  mainWindow.webContents.on('zoom-changed', () => applyLockedZoom(mainWindow));
  mainWindow.on('focus', () => applyLockedZoom(mainWindow));
  mainWindow.on('resize', () => applyLockedZoom(mainWindow));

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5124');
  } else {
    mainWindow.loadFile(getUIPath());
  }

  try {
    const manager = registerUpdateManager({
      log: nfcLog,
      publishStatus: (status) => {
        mainWindow?.webContents.send('update:statusChanged', status);
      },
    });
    updateManager = manager;
    updateIpcFacade = {
      getStatus: () => manager.getStatus(),
      checkNow: () => manager.checkNow(),
      installNow: () => manager.installNow(),
    };
    manager.start();
  } catch (error) {
    const message = parseUnknownErrorMessage(error);
    nfcLog('error', `[updates] failed to initialize updater: ${message}`);
    updateIpcFacade = createUnavailableUpdateFacade(`Updater unavailable: ${message}`);
  }
});

ipcMain.handle('greet', async (_event: IpcMainInvokeEvent, name: string) => {
  const { MyLibraryBinding } = await import('./bindings.js');
  const obj = new MyLibraryBinding('Electron');
  const result = obj.greet(name);
  console.log('greet result:', result);
  return result;
});

ipcMain.handle('add', async (_event: IpcMainInvokeEvent, a: number, b: number) => {
  const { MyLibraryBinding } = await import('./bindings.js');
  const obj = new MyLibraryBinding('Electron');
  const result = obj.add(a, b);
  console.log('add result:', result);
  return result;
});

ipcMain.handle('nfc:getConnectionState', () => {
  return getNfcConnectionState('startup');
});

ipcMain.handle('connect', async (_event: IpcMainInvokeEvent, port: string) => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");

  // After an HMR reload the renderer's isConnected state resets to false but
  // the underlying serial port is still open in the C++ binding.  If the
  // renderer tries to reconnect to the same port, just confirm success so the
  // UI state syncs without touching the hardware.
  if (connectedPort !== null) {
    if (connectedPort === port) {
      pendingReconnectPort = null;
      nfcLog('info', `Already connected to ${port} — confirming state sync.`);
      publishNfcConnectionState('manual-connect', `Connected to ${port}`);
      return `Connected to ${port} (already open)`;
    }
    throw Object.assign(
      new Error(`Already connected to ${connectedPort}. Disconnect first.`),
      { code: 'HARDWARE_ERROR' }
    );
  }

  nfcLog('info', `Connecting to ${port}...`);
  try {
    const result = await nfcBinding.connect(port);
    connectedPort = port;
    pendingReconnectPort = null;
    nfcLog('info', result);
    publishNfcConnectionState('manual-connect', `Connected to ${port}`);
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    nfcLog('error', msg);
    throw error;
  }
});

ipcMain.handle('disconnect', async () => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");
  nfcLog('info', 'Disconnecting...');
  try {
    pendingReconnectPort = null;
    const disconnectedPort = connectedPort;
    const result = await nfcBinding.disconnect();
    connectedPort = null;
    nfcLog('info', result ? 'Disconnected successfully' : 'Disconnect returned false');
    publishNfcConnectionState(
      'manual-disconnect',
      disconnectedPort
        ? `Disconnected from ${disconnectedPort}`
        : 'Disconnected successfully'
    );
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    nfcLog('error', msg);
    throw error;
  }
});

ipcMain.handle('listComPorts', async () => {
  const ports = await SerialPort.list();
  console.log('[listComPorts]', ports);
  return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer }));
});

ipcMain.handle('saveFile', async (_event: IpcMainInvokeEvent, filename: string, content: string) => {
  if (!mainWindow) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export NFC Log',
    defaultPath: filename,
    filters: [{ name: 'Text files', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
});

// ─── Runtime DTO guards ───────────────────────────────────────────────────────

const CANONICAL_TEST_NAMES = ['ROM Check', 'RAM Check', 'Communication', 'Echo Test', 'Antenna'];

function isSelfTestReportDto(payload: unknown): payload is SelfTestReportDto {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  if (!Array.isArray(obj.results) || obj.results.length !== 5) return false;
  for (let i = 0; i < 5; i++) {
    const r = obj.results[i] as Record<string, unknown>;
    if (!r || typeof r.name !== 'string' || typeof r.status !== 'string' || typeof r.detail !== 'string') return false;
    if (!['success', 'failed', 'skipped'].includes(r.status)) return false;
    if (r.name !== CANONICAL_TEST_NAMES[i]) return false;
  }
  return true;
}

function isCardVersionInfoDto(payload: unknown): payload is CardVersionInfoDto {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  return typeof obj.hwVersion === 'string' && typeof obj.swVersion === 'string' &&
         typeof obj.uidHex === 'string' && typeof obj.storage === 'string' &&
         typeof obj.rawVersionHex === 'string';
}

// ─── New IPC handlers ─────────────────────────────────────────────────────────

ipcMain.handle('getFirmwareVersion', async () => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");
  nfcLog('info', 'Getting firmware version...');
  try {
    const result = await nfcBinding.getFirmwareVersion();
    nfcLog('info', `Firmware: ${result}`);
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    nfcLog('error', msg);
    throw error;
  }
});

ipcMain.handle('runSelfTests', async (event: IpcMainInvokeEvent) => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");
  nfcLog('info', 'Running self-tests...');
  try {
    const payload = await nfcBinding.runSelfTests((row: SelfTestResultDto) => {
      // Stream each result to the renderer as it arrives
      event.sender.send('nfc:selfTestProgress', row);
    });
    if (!isSelfTestReportDto(payload)) {
      const errMsg = 'Native returned malformed self-test payload';
      nfcLog('error', errMsg);
      const e = Object.assign(new Error(errMsg), { code: 'HARDWARE_ERROR' });
      throw e;
    }
    const passed = payload.results.filter(r => r.status === 'success').length;
    nfcLog('info', `Self-tests complete: ${passed}/5 passed`);
    payload.results.forEach(r => {
      const lvl = r.status === 'success' ? 'info' : 'warn';
      nfcLog(lvl, `  ${r.status.toUpperCase().padEnd(7)} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    });
    return payload;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    nfcLog('error', msg);
    throw error;
  }
});

ipcMain.handle('getCardVersion', async () => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");
  nfcLog('info', 'Reading card version...');
  try {
    const payload = await nfcBinding.getCardVersion();
    if (!isCardVersionInfoDto(payload)) {
      const errMsg = 'Native returned malformed card version payload';
      nfcLog('error', errMsg);
      const e = Object.assign(new Error(errMsg), { code: 'HARDWARE_ERROR' });
      throw e;
    }
    nfcLog('info', `Card version — HW: ${payload.hwVersion}  SW: ${payload.swVersion}  UID: ${payload.uidHex}  Storage: ${payload.storage}`);
    return payload;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    nfcLog('error', msg);
    throw error;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  event.preventDefault();

  void (async () => {
    try {
      stopBackgroundSyncLoop();
      updateManager?.stop();

      // Stop new extension-host requests and cancel any active card wait loop.
      cancelCardWait();
      if (bridgeServer) {
        try {
          await closeBridgeServer(bridgeServer);
        } catch {
          // best-effort
        }
        bridgeServer = null;
      }

      if (nfcBinding) {
        try {
          // Clear TSFN-backed logger while JS runtime is still alive.
          nfcBinding.setLogCallback();
        } catch {
          // best-effort
        }
        try {
          await nfcBinding.disconnect();
        } catch {
          // best-effort — process is exiting regardless
        }
      }
    } finally {
      // Close vault DB gracefully.
      closeVault();

      // Zeroize any locally-unlocked sync vault key.
      clearUnlockedVaultRootKey();

      // Zeroize machine secret before process exits.
      if (machineSecret) {
        machineSecret.fill(0);
        machineSecret = null;
      }

      app.exit(0);
    }
  })();
});
