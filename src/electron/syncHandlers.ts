import { ipcMain } from 'electron';

import {
  bootstrapSync,
  checkSyncUsernameExists,
  clearSyncConfigAndSession,
  disableSyncMfa,
  enableSyncMfa,
  getSyncStatus,
  getSyncDevices,
  getSyncKeyEnvelope,
  getSyncMfaStatus,
  loginSync,
  registerSync,
  logoutSync,
  pullSync,
  pushSync,
  runFullSync,
  setSyncKeyEnvelope,
  setupSyncMfa,
  setSyncConfig,
  switchSyncUser,
  updateCurrentSyncDeviceName,
  validateSyncServer,
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
  const prepareVaultKeyWithPassword = async (password: string): Promise<'initialized' | 'unlocked'> => {
    if (!password || password.trim().length === 0) {
      throw new Error('Account password is required to prepare vault key');
    }

    const existing = await getSyncKeyEnvelope();
    if (existing === null) {
      // Re-wrap existing local machine secret so previously-encrypted entries remain readable.
      const existingSecret = deps?.getMachineSecret ? deps.getMachineSecret() : undefined;
      const { envelope, rootKey } = createVaultRootKeyEnvelope(password, {
        keyVersion: 2,
        rootKey: existingSecret,
      });
      try {
        await setSyncKeyEnvelope(envelope);
        setUnlockedVaultRootKey(rootKey, envelope.keyVersion);
      } finally {
        rootKey.fill(0);
      }
      return 'initialized';
    }

    const rootKey = decryptVaultRootKeyFromEnvelope(password, existing);
    try {
      setUnlockedVaultRootKey(rootKey, existing.keyVersion);
    } finally {
      rootKey.fill(0);
    }
    return 'unlocked';
  };

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

  ipcMain.handle('sync:validateServer', async (_ev, payload: { baseUrl: string }) => {
    const result = await validateSyncServer(payload.baseUrl);
    log('info', `sync:validateServer - endpoint ${result.baseUrl}`);
    return result;
  });

  ipcMain.handle('sync:setConfig', (_ev, config: SyncConfigDto) => {
    const status = setSyncConfig(config);
    log('info', `sync:setConfig - endpoint ${status.baseUrl}`);
    return status;
  });

  ipcMain.handle('sync:checkUsername', async () => {
    const exists = await checkSyncUsernameExists();
    log('info', `sync:checkUsername - ${exists ? 'existing' : 'new'} account`);
    return { exists };
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

  ipcMain.handle('sync:register', async (_ev, payload: SyncRegisterDto) => {
    const status = await registerSync(payload.password);
    log('info', `sync:register - account created for ${status.username}`);
    try {
      const mode = await prepareVaultKeyWithPassword(payload.password);
      log('info', `sync:register - vault key ${mode} using account password`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', `sync:register vault-key prepare failed - ${msg}`);
      throw err;
    }
    try {
      const result = await runFullSync();
      log(
        'info',
        `sync:register sync - push(sent=${result.push.sent}, applied=${result.push.applied})` +
          ` pull(received=${result.pull.received}, applied=${result.pull.applied}, deleted=${result.pull.deleted})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', `sync:register post-sync failed - ${msg}`);
    }
    return status;
  });

  ipcMain.handle('sync:login', async (_ev, payload: SyncLoginDto) => {
    const status = await loginSync(payload.password, payload.mfaCode);
    log('info', `sync:login - authenticated as ${status.username}`);
    try {
      const mode = await prepareVaultKeyWithPassword(payload.password);
      log('info', `sync:login - vault key ${mode} using account password`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', `sync:login vault-key prepare failed - ${msg}`);
      throw err;
    }
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

  ipcMain.handle('sync:mfaStatus', async () => {
    return getSyncMfaStatus();
  });

  ipcMain.handle('sync:mfaSetup', async () => {
    const setup = await setupSyncMfa();
    log('info', 'sync:mfaSetup - pending TOTP enrollment generated');
    return setup;
  });

  ipcMain.handle('sync:mfaEnable', async (_ev, payload: SyncMfaCodeDto) => {
    const status = await enableSyncMfa(payload.code);
    log('info', 'sync:mfaEnable - MFA enabled');
    return status;
  });

  ipcMain.handle('sync:mfaDisable', async (_ev, payload: SyncMfaCodeDto) => {
    const status = await disableSyncMfa(payload.code);
    log('warn', 'sync:mfaDisable - MFA disabled');
    return status;
  });

  ipcMain.handle('sync:logout', async () => {
    clearUnlockedVaultRootKey();
    const status = await logoutSync();
    log('info', 'sync:logout - session revoked locally');
    return status;
  });

  ipcMain.handle('sync:switchUser', async () => {
    clearUnlockedVaultRootKey();
    const status = await switchSyncUser();
    log('warn', 'sync:switchUser - sync account cleared and local vault wiped for user switch');
    return status;
  });

  ipcMain.handle('sync:getDevices', async () => {
    const devices = await getSyncDevices();
    log('info', `sync:getDevices - ${devices.length} device(s)`);
    return devices;
  });

  ipcMain.handle('sync:updateCurrentDeviceName', async (_ev, payload: { name: string }) => {
    const device = await updateCurrentSyncDeviceName(payload.name);
    log('info', `sync:updateCurrentDeviceName - renamed current device to "${device.name}"`);
    return device;
  });

  ipcMain.handle('sync:getVaultKeyEnvelope', async () => {
    return getSyncKeyEnvelope();
  });

  ipcMain.handle('sync:getVaultKeyStatus', async () => {
    return buildVaultKeyStatus();
  });

  ipcMain.handle('sync:prepareVaultKey', async (_ev, payload: SyncVaultKeyPasswordDto) => {
    const mode = await prepareVaultKeyWithPassword(payload.password);
    log('info', `sync:prepareVaultKey - vault key ${mode} with account password`);
    return buildVaultKeyStatus();
  });

  // Deprecated compatibility channels (old renderer builds still call these).
  ipcMain.handle('sync:initVaultKey', async (_ev, payload: { passphrase: string }) => {
    const existing = await getSyncKeyEnvelope();
    if (existing !== null) {
      throw new Error('Vault key envelope already exists. Use unlock instead.');
    }
    const mode = await prepareVaultKeyWithPassword(payload.passphrase);
    log('warn', `sync:initVaultKey (compat) - routed to prepareVaultKey (${mode})`);
    return buildVaultKeyStatus();
  });

  ipcMain.handle('sync:unlockVaultKey', async (_ev, payload: { passphrase: string }) => {
    const existing = await getSyncKeyEnvelope();
    if (existing === null) {
      throw new Error('No vault key envelope found on server. Initialize it first.');
    }
    const mode = await prepareVaultKeyWithPassword(payload.passphrase);
    log('warn', `sync:unlockVaultKey (compat) - routed to prepareVaultKey (${mode})`);
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
