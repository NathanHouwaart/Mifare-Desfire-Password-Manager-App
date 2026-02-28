import { useEffect, useState } from 'react';
import { Cloud, HardDrive, Sparkles, X } from 'lucide-react';
import { SyncSetupFlow } from './SyncSetupFlow';

type OnboardingMode = 'local' | 'synced';

interface OnboardingScreenProps {
  initialMode?: OnboardingMode | null;
  initialSyncConfig?: SyncInvitePayloadDto | null;
  onCancel?: () => void;
  onComplete: (mode: OnboardingMode) => void;
  showGuideIntro?: boolean;
  onSkipGuideIntro?: () => void;
  asModal?: boolean;
}

function toFriendlySyncError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toLowerCase();
  if (text.includes('failed to fetch') || text.includes('network')) {
    return 'Cannot reach the sync server. Check server URL and network.';
  }
  return raw;
}

export const OnboardingScreen = ({
  initialMode = null,
  initialSyncConfig = null,
  onCancel,
  onComplete,
  showGuideIntro = false,
  onSkipGuideIntro,
  asModal = false,
}: OnboardingScreenProps) => {
  const [mode, setMode] = useState<OnboardingMode | null>(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const publishSyncMode = (nextMode: OnboardingMode) => {
    localStorage.setItem('setting-sync-mode', nextMode);
    window.dispatchEvent(new CustomEvent('securepass:sync-mode-changed', { detail: { mode: nextMode } }));
  };

  const handleUseLocal = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:clearConfig']();
      publishSyncMode('local');
      onComplete('local');
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'synced') {
    return (
      <SyncSetupFlow
        initialSyncConfig={initialSyncConfig}
        onBack={() => setMode(null)}
        onCancel={onCancel}
        asModal={asModal}
        onComplete={() => {
          publishSyncMode('synced');
          onComplete('synced');
        }}
      />
    );
  }

  const outerCls = asModal
    ? 'relative w-full'
    : 'relative h-screen w-screen overflow-hidden bg-page flex items-center justify-center px-4';

  return (
    <div className={outerCls}>
      {!asModal && (
        <>
          <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        </>
      )}

      <div className="relative w-full max-w-[480px] z-10 mx-auto">
        <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-indigo-500/25 via-violet-500/20 to-cyan-500/20 blur-[2px]" />
        <div className="relative rounded-3xl border border-edge bg-card/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-edge/50">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-accent-soft border border-accent-edge flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-accent" />
              </div>
              <span className="text-[11px] font-bold text-mid tracking-widest uppercase">SecurePass Setup</span>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="h-8 px-2.5 rounded-xl border border-edge bg-input flex items-center justify-center gap-1.5 text-[12px] font-medium text-dim hover:text-mid hover:border-edge2 transition-all duration-100 active:scale-95"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="px-5 pt-5 pb-6 [animation:wizardSlideHorizontal_0.28s_cubic-bezier(0.22,1,0.36,1)_both]">
            <div className="text-center mb-6">
              <div className="inline-flex h-14 w-14 rounded-2xl bg-accent-soft border border-accent-edge items-center justify-center mb-3">
                <Sparkles className="w-7 h-7 text-accent" />
              </div>
              <h1 className="text-[22px] font-semibold text-hi">Welcome to SecurePass</h1>
              <p className="mt-1.5 text-[13px] text-lo">Let's get your passwords set up. This takes about 2 minutes.</p>

              {showGuideIntro && (
                <div className="mt-3 rounded-xl border border-accent-edge bg-accent-soft p-3 text-left">
                  <p className="text-[12px] font-medium text-mid">
                    Guided setup is active. After this choice, hints will guide sync, card setup, and first password use.
                  </p>
                  {onSkipGuideIntro && (
                    <button
                      type="button"
                      onClick={onSkipGuideIntro}
                      className="mt-2 h-8 px-2.5 rounded-lg border border-edge bg-input text-[12px] font-medium text-lo hover:text-mid hover:border-edge2 transition-all duration-100 active:scale-95"
                    >
                      Skip Guided Setup
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button onClick={handleUseLocal} disabled={busy} className="group rounded-2xl border border-edge bg-input p-5 text-left hover:border-accent-edge hover:bg-accent-soft transition-all duration-200 disabled:opacity-50">
                <div className="flex items-start gap-4">
                  <div className="h-11 w-11 rounded-xl bg-card border border-edge flex items-center justify-center flex-shrink-0 group-hover:border-accent-edge transition-all">
                    <HardDrive className="w-5 h-5 text-mid group-hover:text-accent transition-colors" />
                  </div>
                  <div>
                    <p className="text-[16px] font-semibold text-hi">Just this computer</p>
                    <p className="mt-1 text-[13px] text-lo">Passwords stay on this device only. You can add backup later.</p>
                    <p className="mt-1 text-[12px] text-dim">Next: set your unlock PIN.</p>
                  </div>
                </div>
              </button>

              <button onClick={() => setMode('synced')} disabled={busy} className="group rounded-2xl border border-edge bg-input p-5 text-left hover:border-accent-edge hover:bg-accent-soft transition-all duration-200 disabled:opacity-50">
                <div className="flex items-start gap-4">
                  <div className="h-11 w-11 rounded-xl bg-card border border-edge flex items-center justify-center flex-shrink-0 group-hover:border-accent-edge transition-all">
                    <Cloud className="w-5 h-5 text-mid group-hover:text-accent transition-colors" />
                  </div>
                  <div>
                    <p className="text-[16px] font-semibold text-hi">Back up and sync</p>
                    <p className="mt-1 text-[13px] text-lo">Use invite link or manual setup, then continue with account phases.</p>
                  </div>
                </div>
              </button>
            </div>

            {message && (
              <p className={`mt-4 text-[13px] ${message.type === 'ok' ? 'text-ok' : 'text-err'}`}>
                {message.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
