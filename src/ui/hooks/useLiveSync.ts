import { useEffect, useRef } from 'react';

export function useLiveSync(enabled: boolean): void {
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    if (typeof window.electron.onSyncApplied !== 'function') return;

    const unsubscribe = window.electron.onSyncApplied((payload) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const didWork = payload.push.sent > 0 || payload.pull.received > 0;
        if (!didWork) return;
        window.dispatchEvent(new Event('securepass:vault-sync-applied'));
      } finally {
        runningRef.current = false;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [enabled]);
}
