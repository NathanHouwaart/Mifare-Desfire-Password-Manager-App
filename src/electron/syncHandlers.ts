import { ipcMain } from 'electron';

import {
  bootstrapSync,
  clearSyncConfigAndSession,
  getSyncStatus,
  loginSync,
  logoutSync,
  pullSync,
  pushSync,
  runFullSync,
  setSyncConfig,
} from './syncService.js';

export function registerSyncHandlers(
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
): void {
  ipcMain.handle('sync:getStatus', () => getSyncStatus());

  ipcMain.handle('sync:setConfig', (_ev, config: SyncConfigDto) => {
    const status = setSyncConfig(config);
    log('info', `sync:setConfig - endpoint ${status.baseUrl}`);
    return status;
  });

  ipcMain.handle('sync:clearConfig', () => {
    const status = clearSyncConfigAndSession();
    log('warn', 'sync:clearConfig - local sync config/session removed');
    return status;
  });

  ipcMain.handle('sync:bootstrap', async (_ev, payload: SyncBootstrapDto) => {
    const status = await bootstrapSync(payload.password, payload.bootstrapToken);
    log('info', `sync:bootstrap - account bootstrapped for ${status.username}`);
    try {
      const result = await runFullSync();
      log(
        'info',
        `sync:bootstrap sync - push(sent=${result.push.sent}, applied=${result.push.applied})` +
          ` pull(received=${result.pull.received}, applied=${result.pull.applied}, deleted=${result.pull.deleted})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', `sync:bootstrap post-sync failed - ${msg}`);
    }
    return status;
  });

  ipcMain.handle('sync:login', async (_ev, payload: SyncLoginDto) => {
    const status = await loginSync(payload.password);
    log('info', `sync:login - authenticated as ${status.username}`);
    try {
      const result = await runFullSync();
      log(
        'info',
        `sync:login sync - push(sent=${result.push.sent}, applied=${result.push.applied})` +
          ` pull(received=${result.pull.received}, applied=${result.pull.applied}, deleted=${result.pull.deleted})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', `sync:login post-sync failed - ${msg}`);
    }
    return status;
  });

  ipcMain.handle('sync:logout', async () => {
    const status = await logoutSync();
    log('info', 'sync:logout - session revoked locally');
    return status;
  });

  ipcMain.handle('sync:push', async () => {
    const result = await pushSync();
    log('info', `sync:push - sent=${result.sent}, applied=${result.applied}, skipped=${result.skipped}`);
    return result;
  });

  ipcMain.handle('sync:pull', async () => {
    const result = await pullSync();
    log('info', `sync:pull - received=${result.received}, applied=${result.applied}, deleted=${result.deleted}`);
    return result;
  });

  ipcMain.handle('sync:syncNow', async () => {
    const result = await runFullSync();
    log(
      'info',
      `sync:syncNow - push(sent=${result.push.sent}, applied=${result.push.applied})` +
        ` pull(received=${result.pull.received}, applied=${result.pull.applied}, deleted=${result.pull.deleted})`
    );
    return result;
  });
}
