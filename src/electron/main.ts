import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, dialog, safeStorage, clipboard } from 'electron'
import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDev } from './utils.js';
import { MyLibraryBinding, NfcCppBinding } from './bindings.js';
import { getPreloadPath, getUIPath } from './pathResolver.js';
import { openVault, closeVault } from './vault.js';
import { registerCardHandlers } from './cardHandlers.js';
import { registerVaultHandlers } from './vaultHandlers.js';
import { cancelCardWait } from './nfcCancel.js';

// Add global error handlers to catch crashes
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});

let mainWindow: BrowserWindow | null = null;
let nfcBinding: NfcCppBinding | null = null;

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

app.on('ready', () => {
  console.log('[MAIN.TS] App ready event fired');

  // Initialise machine secret (fail-closed if safeStorage unavailable).
  initMachineSecret();

  // Open vault DB and run any pending migrations.
  openVault();

  nfcBinding = new NfcCppBinding();

  // Register card and vault IPC handlers now that nfcBinding exists.
  registerCardHandlers(nfcBinding, nfcLog);
  registerVaultHandlers(nfcBinding, nfcLog);

  // Allow the renderer to abort any in-progress card-wait polling loop.
  ipcMain.handle('nfc:cancel', () => { cancelCardWait(); });

  // Clear the system clipboard from the main process (no focus restriction).
  ipcMain.handle('clipboard:clear', () => { clipboard.writeText(''); });

  // Forward all C++ library logs to the in-app debug terminal
  nfcBinding.setLogCallback((level: string, message: string) => {
    const l: 'info' | 'warn' | 'error' =
      level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'info';
    sendLogToRenderer(l, message);
  });

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5124');
  } else {
    mainWindow.loadFile(getUIPath());
  }
});

ipcMain.handle('greet', (_event: IpcMainInvokeEvent, name: string) => {
  const obj = new MyLibraryBinding('Electron');
  const result = obj.greet(name);
  console.log('greet result:', result);
  return result;
});

ipcMain.handle('add', (_event: IpcMainInvokeEvent, a: number, b: number) => {
  const obj = new MyLibraryBinding('Electron');
  const result = obj.add(a, b);
  console.log('add result:', result);
  return result;
});

ipcMain.handle('connect', async (_event: IpcMainInvokeEvent, port: string) => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");
  nfcLog('info', `Connecting to ${port}...`);
  try {
    const result = await nfcBinding.connect(port);
    nfcLog('info', result);
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    nfcLog('error', msg);
    throw error;
  }
});

ipcMain.handle('disconnect', async (_event: IpcMainInvokeEvent) => {
  if (!nfcBinding) throw new Error("NFC Binding not initialized");
  nfcLog('info', 'Disconnecting...');
  try {
    const result = await nfcBinding.disconnect();
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

app.on('before-quit', async () => {
  if (nfcBinding) {
    try {
      await nfcBinding.disconnect();
    } catch {
      // best-effort — process is exiting regardless
    }
  }

  // Close vault DB gracefully.
  closeVault();

  // Zeroize machine secret before process exits.
  if (machineSecret) {
    machineSecret.fill(0);
    machineSecret = null;
  }
});
