import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, dialog, safeStorage, clipboard, shell, nativeImage } from 'electron'
import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Server } from 'node:net';
import { isDev } from './utils.js';
import { getPreloadPath, getUIPath } from './pathResolver.js';
import { openVault, closeVault } from './vault.js';
import { registerCardHandlers } from './cardHandlers.js';
import { registerVaultHandlers } from './vaultHandlers.js';
import { registerSyncHandlers }  from './syncHandlers.js';
import { getSyncStatus, runFullSync } from './syncService.js';
import { clearUnlockedVaultRootKey, getUnlockedVaultRootKey } from './vaultKeyManager.js';
import { startBridgeServer }    from './bridgeServer.js';
import { cancelCardWait }       from './nfcCancel.js';
import { registerNativeHost }   from './nativeHostRegistrar.js';
import type { NfcCppBinding as NfcCppBindingType } from './bindings.js';

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
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const APP_PROTOCOL_SCHEME = 'securepass';

let autoSyncTimer: NodeJS.Timeout | null = null;
let autoSyncRunning = false;
let pendingSyncInvite: SyncInvitePayloadDto | null = null;

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
    return {
      baseUrl: normalizedBaseUrl,
      username: username && username.length > 0 ? username : undefined,
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

async function runBackgroundSync(reason: 'startup' | 'interval'): Promise<void> {
  if (autoSyncRunning) return;

  const status = getSyncStatus();
  if (!status.configured || !status.loggedIn) return;

  autoSyncRunning = true;
  try {
    const result = await runFullSync();
    const didWork = result.push.sent > 0 || result.pull.received > 0;
    if (didWork) {
      nfcLog(
        'info',
        `[sync] ${reason}: push sent=${result.push.sent}, applied=${result.push.applied}; ` +
        `pull received=${result.pull.received}, applied=${result.pull.applied}, deleted=${result.pull.deleted}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    nfcLog('warn', `[sync] ${reason} failed: ${msg}`);
  } finally {
    autoSyncRunning = false;
  }
}

function startBackgroundSyncLoop(): void {
  if (autoSyncTimer) return;
  void runBackgroundSync('startup');
  autoSyncTimer = setInterval(() => {
    void runBackgroundSync('interval');
  }, AUTO_SYNC_INTERVAL_MS);
}

function stopBackgroundSyncLoop(): void {
  if (!autoSyncTimer) return;
  clearInterval(autoSyncTimer);
  autoSyncTimer = null;
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
      title: 'SecurePass Is Not Running',
      message: 'SecurePass must already be open to use this invite link.',
      detail: 'Open SecurePass first, then open the invite link again.',
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
  registerVaultHandlers(nfcBinding, nfcLog);
  registerSyncHandlers(nfcLog, { getMachineSecret });
  startBackgroundSyncLoop();

  // Start the named-pipe bridge that feeds the browser extension.
  bridgeServer = startBridgeServer(nfcBinding, nfcLog);

  // Keep the native messaging host registration up-to-date so the browser
  // extension always points to the correct install location.
  registerNativeHost((msg) => nfcLog('info', msg));

  // Allow the renderer to abort any in-progress card-wait polling loop.
  ipcMain.handle('nfc:cancel', () => { cancelCardWait(); });

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
    title: 'SecurePass',
    icon: iconImg,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      zoomFactor: LOCKED_ZOOM_FACTOR,
    }
  });

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

ipcMain.handle('connect', async (_event: IpcMainInvokeEvent, port: string) => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");

  // After an HMR reload the renderer's isConnected state resets to false but
  // the underlying serial port is still open in the C++ binding.  If the
  // renderer tries to reconnect to the same port, just confirm success so the
  // UI state syncs without touching the hardware.
  if (connectedPort !== null) {
    if (connectedPort === port) {
      nfcLog('info', `Already connected to ${port} — confirming state sync.`);
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
    nfcLog('info', result);
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
    const result = await nfcBinding.disconnect();
    connectedPort = null;
    nfcLog('info', result ? 'Disconnected successfully' : 'Disconnect returned false');
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
