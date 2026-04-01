import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INSTALL_ID_FILENAME = 'sync-installation-id.txt';

type AutoUpdaterMock = EventEmitter & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: ReturnType<typeof vi.fn<() => Promise<void>>>;
  downloadUpdate: ReturnType<typeof vi.fn<() => Promise<void>>>;
  quitAndInstall: ReturnType<typeof vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>>;
};

type ManagerTestContext = {
  manager: import('../src/electron/updateManager.ts').UpdateManagerController;
  autoUpdater: AutoUpdaterMock;
  appMock: {
    getPath: ReturnType<typeof vi.fn<(name: string) => string>>;
    getVersion: ReturnType<typeof vi.fn<() => string>>;
    isPackaged: boolean;
  };
  statuses: AppUpdateStatusDto[];
};

function createAutoUpdaterMock(): AutoUpdaterMock {
  const emitter = new EventEmitter() as AutoUpdaterMock;
  emitter.autoDownload = true;
  emitter.autoInstallOnAppQuit = true;
  emitter.checkForUpdates = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  emitter.downloadUpdate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  emitter.quitAndInstall = vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>();
  return emitter;
}

function expectedBucketForInstallationId(id: string): number {
  const digest = crypto.createHash('sha256').update(id, 'utf8').digest();
  return digest.readUInt32BE(0) % 100;
}

function writeInstallationId(userDataDir: string, installationId: string): void {
  fs.writeFileSync(path.join(userDataDir, INSTALL_ID_FILENAME), installationId, 'utf8');
}

async function createContext(userDataDir: string): Promise<ManagerTestContext> {
  const autoUpdater = createAutoUpdaterMock();
  const appMock = {
    getPath: vi.fn<(name: string) => string>().mockReturnValue(userDataDir),
    getVersion: vi.fn<() => string>().mockReturnValue('0.99.2'),
    isPackaged: true,
  };
  const statuses: AppUpdateStatusDto[] = [];

  vi.resetModules();
  vi.doMock('electron', () => ({
    app: appMock,
  }));
  vi.doMock('electron-updater', () => ({
    autoUpdater,
  }));

  const mod = await import('../src/electron/updateManager.ts');
  const manager = mod.registerUpdateManager({
    log: () => undefined,
    publishStatus: (status) => statuses.push(status),
  });

  return {
    manager,
    autoUpdater,
    appMock,
    statuses,
  };
}

describe('registerUpdateManager', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'securepass-updates-'));
    process.env.NODE_ENV = 'production';
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.doUnmock('electron-updater');
    fs.rmSync(userDataDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('keeps rollout bucket deterministic from persisted installation id', async () => {
    const installationId = 'sp-fixed-installation-0001';
    writeInstallationId(userDataDir, installationId);
    const expectedBucket = expectedBucketForInstallationId(installationId);

    const contextA = await createContext(userDataDir);
    const bucketA = contextA.manager.getStatus().rolloutBucket;
    contextA.manager.stop();

    const contextB = await createContext(userDataDir);
    const bucketB = contextB.manager.getStatus().rolloutBucket;
    contextB.manager.stop();

    expect(bucketA).toBe(expectedBucket);
    expect(bucketB).toBe(expectedBucket);
    expect(contextA.statuses.length).toBe(0);
    expect(contextB.statuses.length).toBe(0);
  });

  it('auto-downloads eligible updates when auto-download preference is enabled', async () => {
    const context = await createContext(userDataDir);
    context.autoUpdater.checkForUpdates.mockImplementation(async () => {
      context.autoUpdater.emit('update-available', {
        version: '0.99.3',
        releaseDate: '2026-04-01T00:00:00.000Z',
        releaseName: 'v0.99.3',
        stagingPercentage: 100,
      });
    });

    await context.manager.checkNow();
    context.manager.stop();

    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(context.manager.getStatus().state).toBe('update-available');
    expect(context.manager.getStatus().eligibleForRollout).toBe(true);
    expect(context.statuses.some((status) => status.state === 'checking')).toBe(true);
    expect(context.statuses.some((status) => status.state === 'update-available')).toBe(true);
  });

  it('skips startup auto-download when disabled but still downloads on manual check', async () => {
    const context = await createContext(userDataDir);
    context.autoUpdater.checkForUpdates.mockImplementation(async () => {
      context.autoUpdater.emit('update-available', {
        version: '0.99.3',
        releaseDate: '2026-04-01T00:00:00.000Z',
        stagingPercentage: 100,
      });
    });

    context.manager.setPreferences({ autoDownloadEnabled: false });

    context.manager.start();
    await Promise.resolve();
    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(0);

    await context.manager.checkNow();
    context.manager.stop();

    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('marks updates as not eligible when rollout percentage excludes this client', async () => {
    const context = await createContext(userDataDir);
    context.autoUpdater.checkForUpdates.mockImplementation(async () => {
      context.autoUpdater.emit('update-available', {
        version: '0.99.3',
        releaseDate: '2026-04-01T00:00:00.000Z',
        stagingPercentage: 0,
      });
    });

    await context.manager.checkNow();
    context.manager.stop();

    const status = context.manager.getStatus();
    expect(status.state).toBe('not-eligible');
    expect(status.eligibleForRollout).toBe(false);
    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(0);
  });

  it('installs only after an update has been downloaded', async () => {
    vi.useFakeTimers();
    const context = await createContext(userDataDir);

    const beforeDownload = await context.manager.installNow();
    expect(beforeDownload.ok).toBe(false);

    context.autoUpdater.emit('update-downloaded', {
      version: '0.99.3',
      releaseDate: '2026-04-01T00:00:00.000Z',
    });

    const afterDownload = await context.manager.installNow();
    expect(afterDownload.ok).toBe(true);

    vi.advanceTimersByTime(100);
    context.manager.stop();

    expect(context.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(context.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('persists update preferences across manager instances', async () => {
    const contextA = await createContext(userDataDir);
    contextA.manager.setPreferences({ autoDownloadEnabled: false });
    contextA.manager.stop();

    const contextB = await createContext(userDataDir);
    const persisted = contextB.manager.getPreferences();
    contextB.manager.stop();

    expect(persisted.autoDownloadEnabled).toBe(false);
  });
});
