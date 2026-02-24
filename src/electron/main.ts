import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, dialog } from 'electron'
import { SerialPort } from 'serialport';
import fs from 'fs';
import { isDev } from './utils.js';
import { MyLibraryBinding, NfcCppBinding } from './bindings.js';
import { getPreloadPath, getUIPath } from './pathResolver.js';

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
  nfcBinding = new NfcCppBinding();

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
});
