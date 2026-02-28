import { useEffect } from 'react';
import { CheckCircle2, Cloud, Cpu, CreditCard, KeyRound, Play, X } from 'lucide-react';

export type GuideStepId = 'sync' | 'reader' | 'card' | 'add' | 'reveal';

interface GuideStep {
  id: GuideStepId;
  title: string;
  body: string;
  done: boolean;
}

interface GettingStartedCoachProps {
  open: boolean;
  path: string;
  syncMode: 'local' | 'synced';
  syncReady: boolean;
  nfcConnected: boolean;
  cardReady: boolean;
  hasCredential: boolean;
  hasReveal: boolean;
  skippedSteps: GuideStepId[];
  onHideForNow: () => void;
  onSkipGuide: () => void;
  onSkipStep: (stepId: GuideStepId) => void;
  onFinishGuide: () => void;
  onOpenSyncSettings: () => void;
  onNavigate: (path: string) => void;
  onOpenNewCredential: () => void;
  onCurrentStepChange?: (stepId: GuideStepId | null) => void;
}

export const GettingStartedCoach = ({
  open,
  path,
  syncMode,
  syncReady,
  nfcConnected,
  cardReady,
  hasCredential,
  hasReveal,
  skippedSteps,
  onHideForNow,
  onSkipGuide,
  onSkipStep,
  onFinishGuide,
  onOpenSyncSettings,
  onNavigate,
  onOpenNewCredential,
  onCurrentStepChange,
}: GettingStartedCoachProps) => {
  if (!open) return null;

  const steps: GuideStep[] = [
    {
      id: 'sync',
      title: 'Account Setup',
      body: syncMode === 'local'
        ? 'Local mode is selected. You can continue and add backup later.'
        : 'Finish sign-in in Sync settings so backup works.',
      done: syncMode === 'local' || syncReady,
    },
    {
      id: 'reader',
      title: 'Connect NFC Reader',
      body: 'Open NFC Reader and connect your reader.',
      done: nfcConnected,
    },
    {
      id: 'card',
      title: 'Initialize Card',
      body: syncMode === 'synced'
        ? 'Open Card page and probe your card. If it belongs to this vault you are done. Initialize only for a brand-new or empty vault.'
        : 'Open Card page and run Initialize Card once.',
      done: cardReady,
    },
    {
      id: 'add',
      title: 'Add First Password',
      body: 'Open Passwords and create your first credential.',
      done: hasCredential,
    },
    {
      id: 'reveal',
      title: 'Practice Card Tap',
      body: 'Use Show on a credential, then tap card to reveal.',
      done: hasReveal,
    },
  ];

  const currentStep =
    steps.find((step) => !step.done && !skippedSteps.includes(step.id)) ?? null;
  const completedCount = steps.filter((step) => step.done || skippedSteps.includes(step.id)).length;
  const currentStepIndex = currentStep ? steps.findIndex((step) => step.id === currentStep.id) : -1;

  useEffect(() => {
    onCurrentStepChange?.(currentStep?.id ?? null);
  }, [currentStep?.id, onCurrentStepChange]);

  const actionForCurrentStep = () => {
    if (!currentStep) return null;

    if (currentStep.id === 'sync') {
      return (
        <button
          onClick={onOpenSyncSettings}
          className="px-3 py-2 rounded-xl border border-accent-edge bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 active:scale-95 transition-all duration-100"
        >
          Open Sync Settings
        </button>
      );
    }

    if (currentStep.id === 'reader') {
      if (path === '/nfc') {
        return <p className="text-[12px] text-lo">Use the connect controls on this page.</p>;
      }
      return (
        <button
          onClick={() => onNavigate('/nfc')}
          className="px-3 py-2 rounded-xl border border-accent-edge bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 active:scale-95 transition-all duration-100"
        >
          Go To NFC Reader
        </button>
      );
    }

    if (currentStep.id === 'card') {
      if (path === '/card') {
        return (
          <p className="text-[12px] text-lo">
            {syncMode === 'synced'
              ? 'Press Probe Card first. Use Initialize only when setting up a brand-new/empty vault.'
              : 'Click Initialize Card and tap your card once.'}
          </p>
        );
      }
      return (
        <button
          onClick={() => onNavigate('/card')}
          className="px-3 py-2 rounded-xl border border-accent-edge bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 active:scale-95 transition-all duration-100"
        >
          Go To Card Page
        </button>
      );
    }

    if (currentStep.id === 'add') {
      if (path !== '/passwords') {
        return (
          <button
            onClick={() => onNavigate('/passwords')}
            className="px-3 py-2 rounded-xl border border-accent-edge bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 active:scale-95 transition-all duration-100"
          >
            Go To Passwords
          </button>
        );
      }
      return (
        <button
          onClick={onOpenNewCredential}
          className="px-3 py-2 rounded-xl border border-accent-edge bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 active:scale-95 transition-all duration-100"
        >
          Open New Credential
        </button>
      );
    }

    if (currentStep.id === 'reveal') {
      if (path === '/passwords') {
        return <p className="text-[12px] text-lo">Click Show (eye) on a credential, then tap card.</p>;
      }
      return (
        <button
          onClick={() => onNavigate('/passwords')}
          className="px-3 py-2 rounded-xl border border-accent-edge bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 active:scale-95 transition-all duration-100"
        >
          Go To Passwords
        </button>
      );
    }

    return null;
  };

  return (
    <div className="fixed bottom-4 right-4 z-30 w-[min(420px,calc(100vw-2rem))] pointer-events-none">
      <div className="pointer-events-auto rounded-2xl border border-edge bg-card/95 backdrop-blur-xl shadow-[0_14px_45px_rgba(0,0,0,0.3)] overflow-hidden [animation:fadeSlideUp_0.18s_ease_both]">
        <div className="px-4 py-3 border-b border-edge/60 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-widest text-dim font-semibold">Setup Guide</p>
            <p className="text-[14px] text-mid mt-0.5">{completedCount} / {steps.length} done</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onHideForNow}
              className="h-8 px-2.5 rounded-lg border border-edge bg-input text-[12px] text-lo hover:text-mid hover:border-edge2 transition-all duration-100 active:scale-95 flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              Hide
            </button>
            <button
              onClick={onSkipGuide}
              className="h-8 px-2.5 rounded-lg border border-edge bg-input text-[12px] text-lo hover:text-mid hover:border-edge2 transition-all duration-100 active:scale-95"
            >
              Skip
            </button>
          </div>
        </div>

        <div className="px-4 py-3">
          {currentStep ? (
            <div className="rounded-xl border border-accent-edge bg-accent-soft/45 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] text-mid font-medium">
                  Step {currentStepIndex + 1} of {steps.length}
                </p>
                <div className="flex h-6 items-center rounded-md border border-accent-edge bg-card/45 px-2 text-[11px] text-mid">
                  Active
                </div>
              </div>
              <div className="mt-2 flex items-start gap-2.5">
                {currentStep.id === 'sync' && <Cloud className="w-4 h-4 text-accent mt-0.5" />}
                {currentStep.id === 'reader' && <Cpu className="w-4 h-4 text-accent mt-0.5" />}
                {currentStep.id === 'card' && <CreditCard className="w-4 h-4 text-accent mt-0.5" />}
                {(currentStep.id === 'add' || currentStep.id === 'reveal') && <KeyRound className="w-4 h-4 text-accent mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-hi">{currentStep.title}</p>
                  <p className="text-[13px] text-lo mt-0.5 leading-relaxed">{currentStep.body}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-ok-edge bg-ok-soft/45 px-3 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-ok" />
                <p className="text-[15px] font-semibold text-hi">Guide complete</p>
              </div>
              <p className="text-[13px] text-lo mt-1">You can close this guide now.</p>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-edge/60 flex flex-wrap items-center gap-2">
          {currentStep ? (
            <>
              {actionForCurrentStep()}
              <button
                onClick={() => onSkipStep(currentStep.id)}
                className="px-3 py-2 rounded-xl border border-edge bg-input text-[13px] text-lo hover:text-mid hover:border-edge2 transition-all duration-100 active:scale-95"
              >
                Skip Step
              </button>
            </>
          ) : (
            <button
              onClick={onFinishGuide}
              className="px-3 py-2 rounded-xl border border-ok-edge bg-ok-soft text-[13px] font-medium text-ok hover:opacity-90 transition-all duration-100 active:scale-95 flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Finish Guide
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
