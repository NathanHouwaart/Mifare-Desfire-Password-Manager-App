import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Loader2, ShieldCheck } from 'lucide-react';

function formatUpdateIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No handler registered for 'update:")) {
    return 'Updater backend is unavailable in this installed build. Install the latest release and try again.';
  }
  return message;
}

function formatUpdateState(state?: AppUpdateStatusDto['state']): string {
  switch (state) {
    case 'checking':
      return 'Checking for updates';
    case 'update-available':
      return 'Update available';
    case 'downloading':
      return 'Downloading update';
    case 'downloaded':
      return 'Ready to install';
    case 'up-to-date':
      return 'Up to date';
    case 'not-eligible':
      return 'Waiting for staged rollout';
    case 'error':
      return 'Update check failed';
    default:
      return 'Idle';
  }
}

function formatLastChecked(timestamp?: number): string {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleString();
}

function isAutoExpandState(state?: AppUpdateStatusDto['state']): boolean {
  return state === 'update-available'
    || state === 'downloading'
    || state === 'downloaded'
    || state === 'not-eligible'
    || state === 'error';
}

function updateStateTone(state?: AppUpdateStatusDto['state']): string {
  switch (state) {
    case 'up-to-date':
      return 'text-ok';
    case 'update-available':
    case 'downloaded':
      return 'text-accent';
    case 'not-eligible':
      return 'text-warn';
    case 'error':
      return 'text-err';
    default:
      return 'text-hi';
  }
}

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between px-5 py-4">
    <p className="text-[16px] font-medium text-hi">{label}</p>
    <p className="text-[15px] text-lo text-right">{value}</p>
  </div>
);

export const AboutPage = () => {
  const [appVersion, setAppVersion] = useState<string>('Unknown');
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatusDto | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateInstallBusy, setUpdateInstallBusy] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const lastAutoExpandedStateRef = useRef<AppUpdateStatusDto['state'] | null>(null);

  const refreshVersion = async () => {
    try {
      const version = await window.electron['app:getVersion']();
      setAppVersion(version);
      return version;
    } catch {
      setAppVersion('Unknown');
      return 'Unknown';
    }
  };

  const refreshUpdateStatus = async (): Promise<AppUpdateStatusDto | null> => {
    try {
      const status = await window.electron['update:getStatus']();
      setUpdateStatus(status);
      return status;
    } catch {
      setUpdateStatus(null);
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [version, status] = await Promise.all([refreshVersion(), refreshUpdateStatus()]);
      if (cancelled) return;
      if (status?.currentVersion) setAppVersion(status.currentVersion);
      else setAppVersion(version);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window.electron.onUpdateStatusChanged !== 'function') return;
    const unsubscribe = window.electron.onUpdateStatusChanged((status) => {
      setUpdateStatus(status);
      if (status.currentVersion) {
        setAppVersion(status.currentVersion);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const state = updateStatus?.state;
    if (!state) return;

    if (isAutoExpandState(state)) {
      if (lastAutoExpandedStateRef.current !== state) {
        setDetailsExpanded(true);
        lastAutoExpandedStateRef.current = state;
      }
      return;
    }

    lastAutoExpandedStateRef.current = null;
  }, [updateStatus?.state]);

  const handleCheckForUpdates = async () => {
    setUpdateCheckBusy(true);
    setUpdateFeedback(null);
    try {
      const status = await window.electron['update:checkNow']();
      setUpdateStatus(status);
      if (status.currentVersion) setAppVersion(status.currentVersion);
      if (status.state === 'up-to-date') {
        setUpdateFeedback({ type: 'ok', message: 'You are already on the latest version.' });
      } else if (status.state === 'not-eligible') {
        const pct = typeof status.stagingPercentage === 'number' ? status.stagingPercentage : 100;
        const bucket = typeof status.rolloutBucket === 'number' ? status.rolloutBucket : 0;
        setUpdateFeedback({
          type: 'ok',
          message: `Update found, but this device is not in the current staged rollout (${pct}% / bucket ${bucket}).`,
        });
      }
    } catch (error) {
      setUpdateFeedback({ type: 'err', message: formatUpdateIpcError(error) });
    } finally {
      setUpdateCheckBusy(false);
      window.setTimeout(() => setUpdateFeedback(null), 6000);
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateInstallBusy(true);
    setUpdateFeedback(null);
    try {
      const result = await window.electron['update:installNow']();
      if (result.ok) {
        setUpdateFeedback({ type: 'ok', message: 'Installing update and restarting SecurePass NFC...' });
      } else {
        setUpdateFeedback({ type: 'err', message: result.error });
      }
    } catch (error) {
      setUpdateFeedback({ type: 'err', message: formatUpdateIpcError(error) });
    } finally {
      setUpdateInstallBusy(false);
      window.setTimeout(() => setUpdateFeedback(null), 6000);
    }
  };

  const updateProgressPercent = typeof updateStatus?.downloadPercent === 'number'
    ? Math.max(0, Math.min(100, updateStatus.downloadPercent))
    : 0;
  const currentVersion = updateStatus?.currentVersion ?? appVersion;
  const updateStateLabel = formatUpdateState(updateStatus?.state);
  const versionSummary = updateStatus?.availableVersion
    ? `v${currentVersion} -> v${updateStatus.availableVersion}`
    : `Current version: v${currentVersion}`;

  return (
    <div className="px-6 py-6 max-w-2xl w-full mx-auto space-y-5">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge
                        flex items-center justify-center shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-hi leading-tight">About</h1>
          <p className="text-[14px] text-lo mt-0.5">SecurePass NFC - v{appVersion}</p>
        </div>
      </div>

      <div className="bg-card border border-edge rounded-2xl overflow-hidden">
        <div className="px-6 py-6 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-accent-soft border border-accent-edge
                          flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-accent" />
          </div>

          <div>
            <h2 className="text-[19px] font-semibold text-hi">SecurePass NFC</h2>
            <p className="text-[15px] text-lo mt-1">Version {currentVersion}</p>
          </div>

          <p className="text-[15px] text-lo leading-relaxed max-w-sm">
            A secure, NFC-backed password manager built with Electron, React,
            and a native C++ DESFire module.
          </p>
        </div>

        <div className="border-t border-edge px-5 py-4">
          <div className="grid grid-cols-2 gap-3 text-left">
            {[
              ['Framework', 'Electron + React'],
              ['UI', 'Tailwind CSS v4'],
              ['Native', 'C++ / Node-API'],
              ['NFC', 'PN532 / DESFire'],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[12px] text-dim uppercase tracking-wider">{label}</p>
                <p className="text-[15px] text-mid mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-edge px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Download className="w-4 h-4 text-accent" />
            <h3 className="text-[13px] font-semibold text-dim uppercase tracking-widest">Software Update</h3>
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className={`text-[17px] font-semibold ${updateStateTone(updateStatus?.state)}`}>
                {updateStateLabel}
              </p>
              <p className="text-[13px] text-lo mt-0.5">{versionSummary}</p>
            </div>
            <button
              onClick={handleCheckForUpdates}
              disabled={updateCheckBusy || updateStatus?.state === 'checking'}
              className="shrink-0 px-4 py-2.5 rounded-xl text-[15px] font-medium border flex items-center justify-center gap-2
                         active:scale-95 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed
                         text-accent border-accent-edge bg-accent-soft hover:opacity-90"
            >
              {(updateCheckBusy || updateStatus?.state === 'checking') && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {updateCheckBusy || updateStatus?.state === 'checking' ? 'Checking...' : 'Check Now'}
            </button>
          </div>

          {updateStatus?.state === 'downloaded' && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleInstallUpdate}
                disabled={updateInstallBusy}
                className="shrink-0 px-4 py-2.5 rounded-xl text-[15px] font-medium border flex items-center gap-2
                           active:scale-95 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed
                           text-accent border-accent-edge bg-accent-soft hover:opacity-90"
              >
                {updateInstallBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {updateInstallBusy ? 'Installing...' : 'Restart to Install'}
              </button>
            </div>
          )}

          {updateStatus?.error && (
            <p className="mt-3 text-[13px] text-err">Update error: {updateStatus.error}</p>
          )}

          {updateFeedback && (
            <p className={`mt-3 text-[13px] ${updateFeedback.type === 'ok' ? 'text-ok' : 'text-err'}`}>
              {updateFeedback.message}
            </p>
          )}

          <div className="mt-4 border-t border-edge pt-3">
            <button
              type="button"
              onClick={() => setDetailsExpanded((current) => !current)}
              className="w-full flex items-center justify-between text-[13px] text-lo hover:text-hi transition-colors duration-100"
            >
              <span>Update details</span>
              {detailsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            <div
              className={`grid transition-all duration-200 ease-out ${
                detailsExpanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0 mt-0'
              }`}
            >
              <div className="overflow-hidden">
                <div className="rounded-xl border border-edge overflow-hidden">
                  <div className="divide-y divide-edge">
                    <InfoRow label="Current Version" value={currentVersion} />
                    <InfoRow label="Channel" value="Stable" />
                    <InfoRow label="Update Status" value={updateStateLabel} />
                    <InfoRow label="Last Checked" value={formatLastChecked(updateStatus?.lastCheckedAt)} />

                    {updateStatus?.availableVersion && (
                      <InfoRow label="Available Version" value={updateStatus.availableVersion} />
                    )}

                    {updateStatus?.state === 'not-eligible' && (
                      <div className="px-5 py-4">
                        <p className="text-[13px] text-lo leading-relaxed">
                          This release is rolling out gradually. Your device bucket is{' '}
                          <span className="text-hi font-medium">{updateStatus.rolloutBucket ?? 0}</span>
                          {typeof updateStatus.stagingPercentage === 'number' && (
                            <> and the current rollout is <span className="text-hi font-medium">{updateStatus.stagingPercentage}%</span>.</>
                          )}
                        </p>
                      </div>
                    )}

                    {updateStatus?.state === 'downloading' && (
                      <div className="px-5 py-4 flex flex-col gap-2">
                        <div className="h-2 rounded-full bg-input border border-edge overflow-hidden">
                          <div
                            className="h-full bg-accent-solid transition-[width] duration-150"
                            style={{ width: `${updateProgressPercent}%` }}
                          />
                        </div>
                        <p className="text-[13px] text-lo">Downloading {updateProgressPercent.toFixed(1)}%</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
