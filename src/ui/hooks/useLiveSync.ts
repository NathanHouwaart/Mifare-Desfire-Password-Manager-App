import { useEffect, useRef } from 'react';

const LIVE_SYNC_INTERVAL_MS = 12000;

type LiveSyncReason = 'startup' | 'interval' | 'focus' | 'sync-mode-change';

export function useLiveSync(enabled: boolean): void {
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const runLiveSync = async (reason: LiveSyncReason) => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;

      try {
        const mode = (localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local';
        if (mode !== 'synced') return;

        const status = await window.electron['sync:getStatus']();
        if (!status.configured || !status.loggedIn) return;

        const result = await window.electron['sync:syncNow']();
        const didWork = result.push.sent > 0 || result.pull.received > 0;
        if (didWork) {
          window.dispatchEvent(new Event('securepass:vault-sync-applied'));
        }
      } catch (err) {
        console.warn(`[sync] live sync (${reason}) failed`, err);
      } finally {
        runningRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void runLiveSync('interval');
    }, LIVE_SYNC_INTERVAL_MS);

    const onFocus = () => {
      void runLiveSync('focus');
    };
    const onSyncModeChanged = () => {
      void runLiveSync('sync-mode-change');
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('securepass:sync-mode-changed', onSyncModeChanged);

    void runLiveSync('startup');

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('securepass:sync-mode-changed', onSyncModeChanged);
    };
  }, [enabled]);
}
