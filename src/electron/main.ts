import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import { isDev } from './utils.js';
import { MyObject } from './bindings.js';
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

app.on('ready', () => {
  console.log('[MAIN.TS] App ready event fired');

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
    mainWindow.loadURL('http://localhost:5123');
  } else {
    mainWindow.loadFile(getUIPath());
  }
});

ipcMain.handle('greet', (event: IpcMainInvokeEvent, name: string) => {
  const obj = new MyObject('Electron');
  const result = obj.greet(name);
  console.log('greet result:', result);
  return result;
});

ipcMain.handle('add', (event: IpcMainInvokeEvent, a: number, b: number) => {
  const obj = new MyObject('Electron');
  const result = obj.add(a, b);
  console.log('add result:', result);
  return result;
});
