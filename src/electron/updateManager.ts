import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';

import { isDev } from './utils.js';

type ElectronUpdaterNamespace = typeof import('electron-updater') & {
  default?: Partial<typeof import('electron-updater')>;
};

const electronUpdaterNs = electronUpdater as ElectronUpdaterNamespace;
const autoUpdater = electronUpdaterNs.autoUpdater ?? electronUpdaterNs.default?.autoUpdater;
if (!autoUpdater) {
  throw new Error('electron-updater autoUpdater export not found');
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SHARED_INSTALLATION_ID_FILE = 'sync-installation-id.txt';
const UPDATE_PREFERENCES_FILE = 'update-preferences.json';

type UpdateCheckReason = 'startup' | 'interval' | 'manual';

type UpdatePreferences = {
  autoDownloadEnabled: boolean;
};

interface UpdateManagerDeps {
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  publishStatus: (status: AppUpdateStatusDto) => void;
}

export interface UpdateManagerController {
  start: () => void;
  stop: () => void;
  publishCurrentStatus: () => void;
  getStatus: () => AppUpdateStatusDto;
  checkNow: () => Promise<AppUpdateStatusDto>;
  installNow: () => Promise<{ ok: true } | { ok: false; error: string }>;
  getPreferences: () => AppUpdatePreferencesDto;
  setPreferences: (next: AppUpdatePreferencesDto) => AppUpdatePreferencesDto;
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  const asText = String(error ?? '');
  return asText.trim().length > 0 ? asText.trim() : 'Unknown update error';
}

function normalizeInstallId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 16 || trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

function getOrCreateInstallationId(): string {
  const idPath = path.join(app.getPath('userData'), SHARED_INSTALLATION_ID_FILE);

  try {
    if (fs.existsSync(idPath)) {
      const current = fs.readFileSync(idPath, 'utf8');
      const normalized = normalizeInstallId(current);
      if (normalized) return normalized;
    }
  } catch {
    // Fall through and create a new identifier.
  }

  const next = `sp-${crypto.randomUUID()}`;
  fs.writeFileSync(idPath, next, 'utf8');
  return next;
}

function toRolloutBucket(installationId: string): number {
  const digest = crypto.createHash('sha256').update(installationId, 'utf8').digest();
  return digest.readUInt32BE(0) % 100;
}

function normalizeStagingPercentage(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(100, parsed));
    }
  }

  return undefined;
}

function snapshotUpdateInfo(updateInfo: UpdateInfo): Partial<AppUpdateStatusDto> {
  const rawReleaseDate = updateInfo.releaseDate ? new Date(updateInfo.releaseDate) : null;
  const releaseDate = rawReleaseDate && !Number.isNaN(rawReleaseDate.getTime())
    ? rawReleaseDate.toISOString()
    : undefined;

  return {
    availableVersion: typeof updateInfo.version === 'string' ? updateInfo.version : undefined,
    releaseDate,
    releaseName: typeof updateInfo.releaseName === 'string' ? updateInfo.releaseName : undefined,
    stagingPercentage: normalizeStagingPercentage((updateInfo as { stagingPercentage?: unknown }).stagingPercentage),
  };
}

function snapshotDownloadInfo(progress: ProgressInfo): Pick<
  AppUpdateStatusDto,
  'downloadPercent' | 'downloadBytesPerSecond' | 'downloadTransferred' | 'downloadTotal'
> {
  return {
    downloadPercent: Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : undefined,
    downloadBytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? progress.bytesPerSecond : undefined,
    downloadTransferred: Number.isFinite(progress.transferred) ? progress.transferred : undefined,
    downloadTotal: Number.isFinite(progress.total) ? progress.total : undefined,
  };
}

function updatePreferencesPath(): string {
  return path.join(app.getPath('userData'), UPDATE_PREFERENCES_FILE);
}

function readUpdatePreferences(): UpdatePreferences {
  const defaults: UpdatePreferences = { autoDownloadEnabled: true };
  try {
    const raw = fs.readFileSync(updatePreferencesPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<UpdatePreferences>;
    if (typeof parsed.autoDownloadEnabled !== 'boolean') return defaults;
    return { autoDownloadEnabled: parsed.autoDownloadEnabled };
  } catch {
    return defaults;
  }
}

function writeUpdatePreferences(next: UpdatePreferences): void {
  fs.writeFileSync(updatePreferencesPath(), JSON.stringify(next, null, 2), 'utf8');
}

export function registerUpdateManager({ log, publishStatus }: UpdateManagerDeps): UpdateManagerController {
  const installationId = getOrCreateInstallationId();
  const rolloutBucket = toRolloutBucket(installationId);
  let preferences = readUpdatePreferences();

  let started = false;
  let checkInFlight = false;
  let downloadInFlight = false;
  let intervalHandle: NodeJS.Timeout | null = null;
  let currentCheckReason: UpdateCheckReason | null = null;

  let status: AppUpdateStatusDto = {
    state: 'idle',
    currentVersion: app.getVersion(),
    rolloutBucket,
  };

  const emitStatus = (): void => {
    publishStatus(status);
  };

  const updateStatus = (patch: Partial<AppUpdateStatusDto>): AppUpdateStatusDto => {
    status = {
      ...status,
      currentVersion: app.getVersion(),
      rolloutBucket,
      ...patch,
    };
    emitStatus();
    return status;
  };

  const canUseUpdater = (): boolean => {
    return app.isPackaged && !isDev();
  };

  const startDownload = async (): Promise<void> => {
    if (downloadInFlight) return;
    downloadInFlight = true;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      updateStatus({
        state: 'error',
        error: `Failed to download update: ${parseErrorMessage(error)}`,
      });
      log('warn', `[updates] download failed: ${parseErrorMessage(error)}`);
    } finally {
      downloadInFlight = false;
    }
  };

  const checkForUpdates = async (reason: UpdateCheckReason): Promise<AppUpdateStatusDto> => {
    if (!canUseUpdater()) {
      if (reason === 'manual') {
        updateStatus({
          state: 'error',
          lastCheckedAt: Date.now(),
          error: 'Updates are only available in installed production builds.',
        });
      }
      return status;
    }

    if (checkInFlight) return status;
    checkInFlight = true;
    updateStatus({
      state: 'checking',
      lastCheckedAt: Date.now(),
      error: undefined,
      downloadPercent: undefined,
      downloadBytesPerSecond: undefined,
      downloadTransferred: undefined,
      downloadTotal: undefined,
    });

    try {
      currentCheckReason = reason;
      await autoUpdater.checkForUpdates();
    } catch (error) {
      updateStatus({
        state: 'error',
        lastCheckedAt: Date.now(),
        error: parseErrorMessage(error),
      });
      log('warn', `[updates] check failed: ${parseErrorMessage(error)}`);
    } finally {
      currentCheckReason = null;
      checkInFlight = false;
    }

    return status;
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    updateStatus({
      state: 'checking',
      lastCheckedAt: Date.now(),
      error: undefined,
    });
  });

  autoUpdater.on('update-available', (updateInfo: UpdateInfo) => {
    const info = snapshotUpdateInfo(updateInfo);
    const stagingPercentage = info.stagingPercentage;
    const eligibleForRollout =
      stagingPercentage === undefined
        ? true
        : rolloutBucket < stagingPercentage;

    if (!eligibleForRollout) {
      updateStatus({
        state: 'not-eligible',
        ...info,
        eligibleForRollout: false,
        lastCheckedAt: Date.now(),
        error: undefined,
        downloadPercent: undefined,
        downloadBytesPerSecond: undefined,
        downloadTransferred: undefined,
        downloadTotal: undefined,
      });
      return;
    }

    updateStatus({
      state: 'update-available',
      ...info,
      eligibleForRollout: true,
      lastCheckedAt: Date.now(),
      error: undefined,
      downloadPercent: undefined,
      downloadBytesPerSecond: undefined,
      downloadTransferred: undefined,
      downloadTotal: undefined,
    });

    const shouldAutoDownload = preferences.autoDownloadEnabled || currentCheckReason === 'manual';
    if (shouldAutoDownload) {
      void startDownload();
    }
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus({
      state: 'up-to-date',
      availableVersion: undefined,
      releaseDate: undefined,
      releaseName: undefined,
      stagingPercentage: undefined,
      eligibleForRollout: undefined,
      lastCheckedAt: Date.now(),
      error: undefined,
      downloadPercent: undefined,
      downloadBytesPerSecond: undefined,
      downloadTransferred: undefined,
      downloadTotal: undefined,
    });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateStatus({
      state: 'downloading',
      ...snapshotDownloadInfo(progress),
      error: undefined,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    const snapshot = snapshotUpdateInfo(info);
    updateStatus({
      state: 'downloaded',
      ...snapshot,
      eligibleForRollout: true,
      downloadPercent: 100,
      error: undefined,
    });
  });

  autoUpdater.on('error', (error: Error) => {
    updateStatus({
      state: 'error',
      error: parseErrorMessage(error),
      lastCheckedAt: Date.now(),
    });
  });

  const installNow = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!canUseUpdater()) {
      return {
        ok: false as const,
        error: 'Updates are only available in installed production builds.',
      };
    }

    if (status.state !== 'downloaded') {
      return {
        ok: false as const,
        error: 'No downloaded update is ready to install yet.',
      };
    }

    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 100);

    return { ok: true as const };
  };

  const getPreferences = (): AppUpdatePreferencesDto => ({
    autoDownloadEnabled: preferences.autoDownloadEnabled,
  });

  const setPreferences = (next: AppUpdatePreferencesDto): AppUpdatePreferencesDto => {
    preferences = {
      autoDownloadEnabled: Boolean(next.autoDownloadEnabled),
    };
    writeUpdatePreferences(preferences);
    return getPreferences();
  };

  const start = (): void => {
    if (started) return;
    started = true;
    log('info', `[updates] rollout bucket=${rolloutBucket}`);

    if (!canUseUpdater()) {
      log('info', '[updates] updater disabled in development/unpackaged mode');
      updateStatus({
        state: 'idle',
        error: undefined,
      });
      return;
    }

    void checkForUpdates('startup');
    intervalHandle = setInterval(() => {
      void checkForUpdates('interval');
    }, UPDATE_CHECK_INTERVAL_MS);
  };

  const stop = (): void => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    started = false;
  };

  return {
    start,
    stop,
    publishCurrentStatus: emitStatus,
    getStatus: () => ({ ...status }),
    checkNow: () => checkForUpdates('manual'),
    installNow,
    getPreferences,
    setPreferences,
  };
}
