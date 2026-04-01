import { useEffect, useState } from 'react';
import { ArrowLeft, Cloud, HardDrive, ShieldCheck, X } from 'lucide-react';
import { SyncSetupFlow } from './SyncSetupFlow';
import { SetupBrandShield } from './SetupBrandShield';

type OnboardingMode = 'local' | 'synced';
type OnboardingStep = 'welcome' | 'choose';

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
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [syncKey, setSyncKey] = useState(0);
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
        key={syncKey}
        initialSyncConfig={initialSyncConfig}
        onBack={() => setMode(null)}
        onCancel={onCancel}
        asModal={asModal}
        resumeConfiguredState={asModal}
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

      <div className="relative w-full max-w-[620px] z-10 mx-auto">
        <div className="absolute -inset-[1px] rounded-[30px] bg-gradient-to-br from-indigo-500/24 via-violet-500/18 to-cyan-500/16 blur-[2px]" />
        <div className="relative rounded-[30px] border border-edge bg-card/92 shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5 border-b border-edge">
            <div className="flex items-center gap-3">
              <SetupBrandShield size="md" />
              <div>
                <p className="text-[18px] font-semibold text-hi leading-tight">SecurePass NFC Setup</p>
                <p className="text-[13px] text-lo">
                  {step === 'welcome' ? 'Welcome' : 'Step 1 of 2 â€” account type'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {step === 'choose' && (
                <button
                  type="button"
                  onClick={() => setStep('welcome')}
                  className="h-8 w-8 rounded-xl flex items-center justify-center border border-edge bg-input text-dim hover:text-mid hover:border-edge2 transition-all duration-100 active:scale-95"
                  aria-label="Go back"
                  title="Go back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="h-8 w-8 rounded-xl flex items-center justify-center border border-edge bg-input text-dim hover:text-mid hover:border-edge2 transition-all duration-100 active:scale-95"
                  aria-label="Close setup"
                  title="Close setup"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {step === 'welcome' ? (
            <div key="welcome" className="px-8 py-10 flex flex-col items-center text-center [animation:wizardSlideHorizontal_0.28s_cubic-bezier(0.22,1,0.36,1)_both]">
              <SetupBrandShield size="lg" className="mb-6" />
              <h1 className="text-[30px] font-bold text-hi leading-tight tracking-tight">Welcome to SecurePass NFC</h1>
              <p className="mt-3 text-[16px] text-lo max-w-[360px] leading-relaxed">
                Your passwords, protected by NFC hardware. Quick to set up, easy to use.
              </p>
              <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-[400px] text-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-10 w-10 rounded-xl bg-accent-soft border border-accent-edge flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-accent" />
                  </div>
                  <p className="text-[13px] text-lo leading-snug">Hardware-backed security</p>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="h-10 w-10 rounded-xl bg-accent-soft border border-accent-edge flex items-center justify-center">
                    <Cloud className="w-5 h-5 text-accent" />
                  </div>
                  <p className="text-[13px] text-lo leading-snug">Optional multi-device sync</p>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="h-10 w-10 rounded-xl bg-accent-soft border border-accent-edge flex items-center justify-center">
                    <HardDrive className="w-5 h-5 text-accent" />
                  </div>
                  <p className="text-[13px] text-lo leading-snug">Works fully offline</p>
                </div>
              </div>
              <button
                onClick={() => setStep('choose')}
                className="mt-10 h-12 px-10 rounded-2xl bg-accent-solid text-white text-[16px] font-semibold hover:bg-accent-hover transition-all duration-150 active:scale-[0.98] shadow-[0_4px_20px_rgba(99,102,241,0.4)]"
              >
                Get started
              </button>
              {showGuideIntro && onSkipGuideIntro && (
                <button
                  type="button"
                  onClick={onSkipGuideIntro}
                  className="mt-3 text-[14px] text-dim hover:text-mid transition-colors"
                >
                  Skip guided setup
                </button>
              )}
            </div>
          ) : (
            <div key="choose" className="px-6 pt-6 pb-5 [animation:wizardSlideHorizontal_0.28s_cubic-bezier(0.22,1,0.36,1)_both]">
              <div className="mb-6">
                <h1 className="text-[24px] font-semibold text-hi leading-tight">Where do your passwords live?</h1>
                <p className="mt-2 text-[15px] text-lo">Choose a storage mode. You can change this later in Settings.</p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleUseLocal}
                  disabled={busy}
                  className="group flex items-center gap-5 rounded-2xl border border-edge bg-input px-5 py-5 text-left transition-all duration-150 hover:border-accent-edge hover:bg-card disabled:opacity-50"
                >
                  <div className="h-14 w-14 shrink-0 rounded-2xl bg-card border border-edge flex items-center justify-center group-hover:border-accent-edge group-hover:bg-accent-soft transition-all duration-150">
                    <HardDrive className="w-7 h-7 text-mid group-hover:text-accent transition-colors" />
                  </div>
                  <div>
                    <p className="text-[19px] font-semibold text-hi leading-tight">Just this computer</p>
                    <p className="mt-1 text-[14px] text-lo">Stays local. No server required.</p>
                  </div>
                </button>

                <button
                  onClick={() => { setSyncKey((k) => k + 1); setMode('synced'); }}
                  disabled={busy}
                  className="group flex items-center gap-5 rounded-2xl border border-edge bg-input px-5 py-5 text-left transition-all duration-150 hover:border-accent-edge hover:bg-card disabled:opacity-50"
                >
                  <div className="h-14 w-14 shrink-0 rounded-2xl bg-card border border-edge flex items-center justify-center group-hover:border-accent-edge group-hover:bg-accent-soft transition-all duration-150">
                    <Cloud className="w-7 h-7 text-mid group-hover:text-accent transition-colors" />
                  </div>
                  <div>
                    <p className="text-[19px] font-semibold text-hi leading-tight">Sync & backup</p>
                    <p className="mt-1 text-[14px] text-lo">Multi-device access. Server-backed recovery.</p>
                  </div>
                </button>
              </div>

              {message && (
                <p className={`mt-4 text-[14px] ${message.type === 'ok' ? 'text-ok' : 'text-err'}`}>
                  {message.text}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

