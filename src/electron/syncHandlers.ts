import { ipcMain } from 'electron';

import {
  bootstrapSync,
  clearSyncConfigAndSession,
  getSyncStatus,
  getSyncKeyEnvelope,
  loginSync,
  logoutSync,
  pullSync,
  pushSync,
  runFullSync,
  setSyncKeyEnvelope,
  setSyncConfig,
} from './syncService.js';
import {
  clearUnlockedVaultRootKey,
  createVaultRootKeyEnvelope,
  decryptVaultRootKeyFromEnvelope,
  getVaultKeyUnlockState,
  setUnlockedVaultRootKey,
} from './vaultKeyManager.js';

export function registerSyncHandlers(
  log: (level: 'info' | 'warn' | 'error', msg: string) => void,
  deps?: { getMachineSecret?: () => Buffer }
): void {
  const buildVaultKeyStatus = async (): Promise<SyncVaultKeyStatusDto> => {
    const syncStatus = getSyncStatus();
    const local = getVaultKeyUnlockState();
    let hasRemoteEnvelope = false;
    if (syncStatus.configured && syncStatus.loggedIn) {
      try {
        hasRemoteEnvelope = (await getSyncKeyEnvelope()) !== null;
      } catch {
        hasRemoteEnvelope = false;
      }
    }
    return {
      configured: syncStatus.configured,
      loggedIn: syncStatus.loggedIn,
      hasRemoteEnvelope,
      hasLocalUnlockedKey: local.hasLocalUnlockedKey,
      keyVersion: local.keyVersion,
      unlockedAt: local.unlockedAt,
    };
  };

  ipcMain.handle('sync:getStatus', () => getSyncStatus());

  ipcMain.handle('sync:setConfig', (_ev, config: SyncConfigDto) => {
    const status = setSyncConfig(config);
    log('info', `sync:setConfig - endpoint ${status.baseUrl}`);
    return status;
  });

  ipcMain.handle('sync:clearConfig', () => {
    clearUnlockedVaultRootKey();
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
    clearUnlockedVaultRootKey();
    const status = await logoutSync();
    log('info', 'sync:logout - session revoked locally');
    return status;
  });

  ipcMain.handle('sync:getVaultKeyEnvelope', async () => {
    return getSyncKeyEnvelope();
  });

  ipcMain.handle('sync:getVaultKeyStatus', async () => {
    return buildVaultKeyStatus();
  });

  ipcMain.handle('sync:initVaultKey', async (_ev, payload: SyncVaultKeyPassphraseDto) => {
    const existing = await getSyncKeyEnvelope();
    if (existing !== null) {
      throw new Error('Vault key envelope already exists. Use unlock instead.');
    }

    // Migrate seamlessly by wrapping the existing local machine secret.
    // This keeps legacy cards/entries readable across newly-added devices.
    const existingSecret = deps?.getMachineSecret ? deps.getMachineSecret() : undefined;
    const { envelope, rootKey } = createVaultRootKeyEnvelope(payload.passphrase, {
      keyVersion: 2,
      rootKey: existingSecret,
    });
    try {
      await setSyncKeyEnvelope(envelope);
      setUnlockedVaultRootKey(rootKey, envelope.keyVersion);
    } finally {
      rootKey.fill(0);
    }

    log('info', 'sync:initVaultKey - created and uploaded vault key envelope');
    return buildVaultKeyStatus();
  });

  ipcMain.handle('sync:unlockVaultKey', async (_ev, payload: SyncVaultKeyPassphraseDto) => {
    const envelope = await getSyncKeyEnvelope();
    if (envelope === null) {
      throw new Error('No vault key envelope found on server. Initialize it first.');
    }

    const rootKey = decryptVaultRootKeyFromEnvelope(payload.passphrase, envelope);
    try {
      setUnlockedVaultRootKey(rootKey, envelope.keyVersion);
    } finally {
      rootKey.fill(0);
    }

    log('info', `sync:unlockVaultKey - unlocked key version ${envelope.keyVersion}`);
    return buildVaultKeyStatus();
  });

  ipcMain.handle('sync:lockVaultKey', async () => {
    clearUnlockedVaultRootKey();
    log('info', 'sync:lockVaultKey - local unlocked vault key cleared');
    return buildVaultKeyStatus();
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
