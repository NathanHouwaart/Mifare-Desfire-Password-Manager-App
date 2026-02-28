import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Components/Sidebar';
import { LockScreen } from './Components/LockScreen';
import { SplashScreen } from './Components/SplashScreen';
import { OnboardingScreen } from './Components/OnboardingScreen';
import { GettingStartedCoach, type GuideStepId } from './Components/GettingStartedCoach';
import { LockTransition } from './Components/LockTransition';
import { DebugTerminal } from './Components/DebugTerminal';
import { PasswordsPage } from './pages/PasswordsPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { CardPage } from './pages/CardPage';
import { NfcReaderPage } from './pages/NfcReaderPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';
import { useLiveSync } from './hooks/useLiveSync';
import './App.css';

const PIN_HASH_KEY = 'app-pin-hash';
const GUIDE_COMPLETE_KEY = 'app-getting-started-complete';
const GUIDE_DISMISSED_KEY = 'app-getting-started-dismissed';
const GUIDE_CARD_READY_KEY = 'app-getting-started-card-ready';
const GUIDE_CREDENTIAL_KEY = 'app-getting-started-credential-ready';
const GUIDE_REVEAL_KEY = 'app-getting-started-reveal-ready';
const GUIDE_SKIPPED_STEPS_KEY = 'app-getting-started-skipped-steps';

function loadGuideSkippedSteps(): GuideStepId[] {
  const validSteps = new Set<GuideStepId>(['sync', 'reader', 'card', 'add', 'reveal']);
  try {
    const raw = localStorage.getItem(GUIDE_SKIPPED_STEPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((step): step is GuideStepId => typeof step === 'string' && validSteps.has(step as GuideStepId));
  } catch {
    return [];
  }
}

function App() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const path      = location.pathname;

  const [unlocked,         setUnlocked]         = useState(false);
  const [locking,          setLocking]           = useState(false);
  const [appVisible,       setAppVisible]        = useState(false);
  const [showSplash,       setShowSplash]        = useState(true);
  const [needsOnboarding,  setNeedsOnboarding]   = useState(
    () => localStorage.getItem('app-onboarding-complete') !== '1'
  );
  const [onboardingInitialMode, setOnboardingInitialMode] = useState<'local' | 'synced' | null>(null);
  const [syncInvitePrefill, setSyncInvitePrefill] = useState<SyncInvitePayloadDto | null>(null);
  const [pendingSyncInvite, setPendingSyncInvite] = useState<SyncInvitePayloadDto | null>(null);
  const [showSyncModal,    setShowSyncModal]     = useState(false);
  const [isTerminalOpen,   setIsTerminalOpen]    = useState(false);
  const [isNfcConnected,   setIsNfcConnected]    = useState(false);
  const [needsPinSetup,    setNeedsPinSetup]     = useState(
    () => localStorage.getItem('app-onboarding-complete') === '1' && !localStorage.getItem(PIN_HASH_KEY)
  );
  const [terminalEnabled,  setTerminalEnabled]   = useState(
    () => (localStorage.getItem('setting-terminal-enabled') ?? 'true') === 'true'
  );
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('app-theme') as 'dark' | 'light') ?? 'dark'
  );
  const [syncMode, setSyncMode] = useState<'local' | 'synced'>(
    () => (localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local'
  );
  const [guideActive, setGuideActive] = useState(
    () => localStorage.getItem(GUIDE_COMPLETE_KEY) !== '1' && localStorage.getItem(GUIDE_DISMISSED_KEY) !== '1'
  );
  const [guideHiddenForNow, setGuideHiddenForNow] = useState(false);
  const [guideSyncReady, setGuideSyncReady] = useState(
    () => ((localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local') === 'local'
  );
  const [guideCardReady, setGuideCardReady] = useState(
    () => localStorage.getItem(GUIDE_CARD_READY_KEY) === '1'
  );
  const [guideHasCredential, setGuideHasCredential] = useState(
    () => localStorage.getItem(GUIDE_CREDENTIAL_KEY) === '1'
  );
  const [guideHasReveal, setGuideHasReveal] = useState(
    () => localStorage.getItem(GUIDE_REVEAL_KEY) === '1'
  );
  const [guideSkippedSteps, setGuideSkippedSteps] = useState<GuideStepId[]>(() => loadGuideSkippedSteps());
  const [guideCurrentStep, setGuideCurrentStep] = useState<GuideStepId | null>(null);

  // Track whether the window was blurred so the focus handler only acts on
  // a real wake-from-background, not the initial focus on startup.
  const wasBlurred = useRef(false);
  const syncModalRef = useRef<HTMLDivElement | null>(null);

  useLiveSync(unlocked);

  const closeSyncModal = useCallback(() => {
    setShowSyncModal(false);
    setOnboardingInitialMode(null);
    setSyncInvitePrefill(null);
  }, []);

  const openSyncWizard = useCallback((options?: {
    mode?: 'local' | 'synced' | null;
    invite?: SyncInvitePayloadDto | null;
  }) => {
    const currentMode = (localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local';
    const nextMode = options?.mode ?? (currentMode === 'synced' ? 'synced' : null);
    setOnboardingInitialMode(nextMode);
    setSyncInvitePrefill(options?.invite ?? null);
    setShowSyncModal(true);
  }, []);

  const shouldHandleInvite = useCallback(async (): Promise<boolean> => {
    const mode = (localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local';
    if (mode !== 'synced') return true;

    const api = (window as Window & { electron?: Window['electron'] }).electron;
    if (!api || typeof api['sync:getStatus'] !== 'function') return false;

    try {
      const status = await api['sync:getStatus']();
      return !(status.configured && status.loggedIn);
    } catch {
      return false;
    }
  }, []);

  const handleSyncInvite = useCallback(async (invite: SyncInvitePayloadDto) => {
    if (!(await shouldHandleInvite())) return;

    if (needsOnboarding) {
      setOnboardingInitialMode('synced');
      setSyncInvitePrefill(invite);
      return;
    }

    if (!unlocked) {
      setPendingSyncInvite(invite);
      return;
    }

    openSyncWizard({ mode: 'synced', invite });
  }, [needsOnboarding, openSyncWizard, shouldHandleInvite, unlocked]);

  const refreshGuideSyncStatus = useCallback(async () => {
    const currentMode = (localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local';
    setSyncMode(currentMode);
    if (currentMode === 'local') {
      setGuideSyncReady(true);
      return;
    }
    try {
      const status = await window.electron['sync:getStatus']();
      setGuideSyncReady(Boolean(status.configured && status.loggedIn));
    } catch {
      setGuideSyncReady(false);
    }
  }, []);

  const refreshGuideCredentialStatus = useCallback(async () => {
    try {
      const list = await window.electron['vault:listEntries']();
      const hasCredential = list.length > 0;
      setGuideHasCredential(hasCredential);
      if (hasCredential) {
        localStorage.setItem(GUIDE_CREDENTIAL_KEY, '1');
      }
    } catch {
      // Ignore guide refresh errors and keep current state.
    }
  }, []);

  const persistGuideSkippedSteps = useCallback((steps: GuideStepId[]) => {
    localStorage.setItem(GUIDE_SKIPPED_STEPS_KEY, JSON.stringify(steps));
  }, []);

  const skipGuideStep = useCallback((stepId: GuideStepId) => {
    setGuideSkippedSteps((current) => {
      if (current.includes(stepId)) return current;
      const next = [...current, stepId];
      persistGuideSkippedSteps(next);
      return next;
    });
  }, [persistGuideSkippedSteps]);

  const finishGuide = useCallback(() => {
    localStorage.setItem(GUIDE_COMPLETE_KEY, '1');
    localStorage.removeItem(GUIDE_DISMISSED_KEY);
    localStorage.removeItem(GUIDE_SKIPPED_STEPS_KEY);
    setGuideSkippedSteps([]);
    setGuideActive(false);
    setGuideHiddenForNow(false);
  }, []);

  const dismissGuide = useCallback(() => {
    localStorage.setItem(GUIDE_DISMISSED_KEY, '1');
    setGuideActive(false);
    setGuideHiddenForNow(false);
  }, []);

  const toggleTerminalEnabled = () =>
    setTerminalEnabled(prev => {
      const next = !prev;
      localStorage.setItem('setting-terminal-enabled', String(next));
      if (!next) setIsTerminalOpen(false);
      return next;
    });

  // Redirect bare / → /passwords on first render
  useEffect(() => {
    if (path === '/') navigate('/passwords', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Require PIN on wake ──────────────────────────────────────────────────
  // When enabled, lock the vault whenever the app window regains focus after
  // having been blurred (i.e. the user switched away and came back).
  useEffect(() => {
    if (!unlocked) return;
    const onBlur  = () => { wasBlurred.current = true; };
    const onFocus = () => {
      if (!wasBlurred.current) return;
      wasBlurred.current = false;
      const requirePin = (localStorage.getItem('setting-pin-wake') ?? 'false') === 'true';
      if (requirePin) setLocking(true);
    };
    window.addEventListener('blur',  onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur',  onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [unlocked]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const api = (window as Window & { electron?: Window['electron'] }).electron;
    if (!api) return;

    const consumeStartupInvite = async () => {
      if (typeof api['sync:consumeInvite'] !== 'function') return;
      try {
        const startupInvite = await api['sync:consumeInvite']();
        if (startupInvite) {
          void handleSyncInvite(startupInvite);
        }
      } catch {
        // Ignore invite startup failures.
      }
    };

    void consumeStartupInvite();
    if (typeof api.onSyncInvite === 'function') {
      unsub = api.onSyncInvite((invite) => {
        void handleSyncInvite(invite);
      });
    }

    return () => {
      unsub?.();
    };
  }, [handleSyncInvite]);

  useEffect(() => {
    if (!pendingSyncInvite) return;
    if (needsOnboarding) return;
    if (!unlocked) return;

    let cancelled = false;
    const applyPendingInvite = async () => {
      const shouldApply = await shouldHandleInvite();
      if (cancelled) return;
      if (shouldApply) {
        openSyncWizard({ mode: 'synced', invite: pendingSyncInvite });
      }
      setPendingSyncInvite(null);
    };

    void applyPendingInvite();
    return () => {
      cancelled = true;
    };
  }, [needsOnboarding, openSyncWizard, pendingSyncInvite, shouldHandleInvite, unlocked]);

  useEffect(() => {
    const onOpenSyncWizard = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: 'local' | 'synced'; invite?: SyncInvitePayloadDto | null }>).detail;
      const mode = detail?.mode === 'local' || detail?.mode === 'synced' ? detail.mode : null;
      const invite = detail?.invite ?? null;
      setOnboardingInitialMode(mode);
      setSyncInvitePrefill(invite);
      setShowSyncModal(true);
    };

    window.addEventListener('securepass:open-sync-wizard', onOpenSyncWizard);
    return () => {
      window.removeEventListener('securepass:open-sync-wizard', onOpenSyncWizard);
    };
  }, []);

  useEffect(() => {
    const onSyncModeChanged = () => {
      void refreshGuideSyncStatus();
    };
    const onVaultSyncApplied = () => {
      void refreshGuideSyncStatus();
      void refreshGuideCredentialStatus();
    };
    const onGuideCardReady = () => {
      localStorage.setItem(GUIDE_CARD_READY_KEY, '1');
      setGuideCardReady(true);
    };
    const onGuideCredential = () => {
      localStorage.setItem(GUIDE_CREDENTIAL_KEY, '1');
      setGuideHasCredential(true);
    };
    const onGuideReveal = () => {
      localStorage.setItem(GUIDE_REVEAL_KEY, '1');
      setGuideHasReveal(true);
    };

    window.addEventListener('securepass:sync-mode-changed', onSyncModeChanged);
    window.addEventListener('securepass:vault-sync-applied', onVaultSyncApplied);
    window.addEventListener('securepass:guide-card-initialized', onGuideCardReady);
    window.addEventListener('securepass:guide-credential-created', onGuideCredential);
    window.addEventListener('securepass:guide-credential-revealed', onGuideReveal);

    return () => {
      window.removeEventListener('securepass:sync-mode-changed', onSyncModeChanged);
      window.removeEventListener('securepass:vault-sync-applied', onVaultSyncApplied);
      window.removeEventListener('securepass:guide-card-initialized', onGuideCardReady);
      window.removeEventListener('securepass:guide-credential-created', onGuideCredential);
      window.removeEventListener('securepass:guide-credential-revealed', onGuideReveal);
    };
  }, [refreshGuideCredentialStatus, refreshGuideSyncStatus]);

  useEffect(() => {
    if (!guideActive) return;
    if (!unlocked) return;
    void refreshGuideSyncStatus();
    void refreshGuideCredentialStatus();
  }, [guideActive, refreshGuideCredentialStatus, refreshGuideSyncStatus, unlocked]);

  useEffect(() => {
    if (unlocked) return;
    setGuideHiddenForNow(false);
  }, [unlocked]);

  useEffect(() => {
    if (!guideActive || guideHiddenForNow || !unlocked) {
      setGuideCurrentStep(null);
    }
  }, [guideActive, guideHiddenForNow, unlocked]);

  useEffect(() => {
    if (!showSyncModal) return;

    const getFocusable = () => {
      const root = syncModalRef.current;
      if (!root) return [] as HTMLElement[];
      return Array.from(root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSyncModal();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || !syncModalRef.current?.contains(active) || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const focusId = requestAnimationFrame(() => {
      const focusable = getFocusable();
      focusable[0]?.focus();
    });

    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(focusId);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeSyncModal, showSyncModal]);

  // ── Auto-lock on inactivity ──────────────────────────────────────────────
  // Reads the current value from localStorage each time the vault is unlocked
  // so settings changes take effect immediately without a restart.
  useEffect(() => {
    if (!unlocked) return;
    const raw = localStorage.getItem('setting-autolock') ?? '5';
    if (raw === 'never') return;
    const ms = parseInt(raw, 10) * 60 * 1000;
    if (!ms || ms <= 0) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLocking(true), ms);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'] as const;
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset(); // arm the timer immediately

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [unlocked]);

  // Smooth in the main shell after unlock so the handoff from LockScreen
  // doesn't feel like a hard layout swap.
  useEffect(() => {
    if (!unlocked) {
      setAppVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setAppVisible(true));
    return () => cancelAnimationFrame(id);
  }, [unlocked]);

  const toggleTheme = () =>
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('app-theme', next);
      return next;
    });

  const themeClass = theme === 'light' ? 'light' : '';
  const highlightSync = guideCurrentStep === 'sync';
  const highlightReaderNav = guideCurrentStep === 'reader' && path !== '/nfc';
  const highlightReaderConnect = guideCurrentStep === 'reader' && path === '/nfc';
  const highlightCardNav = guideCurrentStep === 'card' && path !== '/card';
  const highlightCardInit = guideCurrentStep === 'card' && path === '/card';
  const highlightPasswordsNav = (guideCurrentStep === 'add' || guideCurrentStep === 'reveal') && path !== '/passwords';
  const highlightPasswordAdd = guideCurrentStep === 'add' && path === '/passwords';
  const highlightPasswordReveal = guideCurrentStep === 'reveal' && path === '/passwords';

  if (showSplash) {
    return (
      <div className={`h-screen w-screen bg-page ${themeClass}`}>
        <SplashScreen onDone={() => setShowSplash(false)} />
      </div>
    );
  }

  if (needsOnboarding) {
    // True first-run: full-screen wizard, no way to cancel
    return (
      <div className={`h-screen w-screen bg-page ${themeClass}`}>
        <OnboardingScreen
          initialMode={onboardingInitialMode}
          initialSyncConfig={syncInvitePrefill}
          showGuideIntro={guideActive}
          onSkipGuideIntro={dismissGuide}
          onComplete={(mode) => {
            localStorage.setItem('app-onboarding-complete', '1');
            localStorage.setItem('setting-sync-mode', mode);
            window.dispatchEvent(new CustomEvent('securepass:sync-mode-changed', { detail: { mode } }));
            setSyncMode(mode);
            setNeedsOnboarding(false);
            const hasPin = Boolean(localStorage.getItem(PIN_HASH_KEY));
            if (!hasPin) {
              localStorage.removeItem('app-pin-setup-intro-seen');
            }
            setNeedsPinSetup(!hasPin);
            setOnboardingInitialMode(null);
            setSyncInvitePrefill(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`h-screen w-screen overflow-hidden bg-page ${themeClass}`}>

      {/* Lock screen — shown when vault is locked */}
      {!unlocked && (
        <LockScreen
          mode={needsPinSetup ? 'setup' : 'auto'}
          onUnlock={() => {
            setNeedsPinSetup(false);
            setUnlocked(true);
          }}
        />
      )}

      {/* Main app — shown when vault is unlocked */}
      {unlocked && (
        <div
          className={`flex h-full w-full overflow-hidden transition-[opacity,transform] duration-300 ease-out
            ${appVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
        >
          <Sidebar
            onLock={() => setLocking(true)}
            isNfcConnected={isNfcConnected}
            onOpenSync={openSyncWizard}
            highlightSync={highlightSync}
            highlightNfcNav={highlightReaderNav}
            highlightCardNav={highlightCardNav}
            highlightPasswordsNav={highlightPasswordsNav}
          />

          {/* flex-col wrapper so the terminal sits in flow — main shrinks as terminal grows */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <main className="flex-1 overflow-y-auto min-h-0 relative">
              {/* All pages are always mounted — CSS hidden preserves state on tab switch */}
              <div className={path === '/passwords' ? 'flex flex-col h-full' : 'hidden'}>
                <PasswordsPage
                  theme={theme}
                  isActive={path === '/passwords'}
                  guideHighlightNewCredential={highlightPasswordAdd}
                  guideHighlightReveal={highlightPasswordReveal}
                />
              </div>
              <div className={path === '/generator' ? 'block' : 'hidden'}>
                <GeneratorPage />
              </div>
              <div className={path === '/card' ? 'block' : 'hidden'}>
                <CardPage
                  isNfcConnected={isNfcConnected}
                  highlightInitAction={highlightCardInit}
                />
              </div>
              <div className={path === '/nfc' ? 'block' : 'hidden'}>
                <NfcReaderPage
                  isTerminalOpen={isTerminalOpen}
                  onToggleTerminal={() => setIsTerminalOpen(p => !p)}
                  isConnected={isNfcConnected}
                  onConnectionChange={setIsNfcConnected}
                  terminalEnabled={terminalEnabled}
                  highlightConnect={highlightReaderConnect}
                />
              </div>
              <div className={path === '/settings' ? 'block' : 'hidden'}>
                <SettingsPage
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  terminalEnabled={terminalEnabled}
                  onToggleTerminalEnabled={toggleTerminalEnabled}
                />
              </div>
              <div className={path === '/about' ? 'block' : 'hidden'}>
                <AboutPage />
              </div>
            </main>

            {terminalEnabled && (
              <DebugTerminal isOpen={isTerminalOpen} onOpenChange={setIsTerminalOpen} />
            )}
          </div>
        </div>
      )}

      {unlocked && guideActive && !guideHiddenForNow && !showSyncModal && (
        <GettingStartedCoach
          open
          path={path}
          syncMode={syncMode}
          syncReady={guideSyncReady}
          nfcConnected={isNfcConnected}
          cardReady={guideCardReady}
          hasCredential={guideHasCredential}
          hasReveal={guideHasReveal}
          skippedSteps={guideSkippedSteps}
          onHideForNow={() => setGuideHiddenForNow(true)}
          onSkipGuide={dismissGuide}
          onSkipStep={skipGuideStep}
          onFinishGuide={finishGuide}
          onOpenSyncSettings={openSyncWizard}
          onNavigate={(nextPath) => navigate(nextPath)}
          onOpenNewCredential={() => {
            navigate('/passwords');
            window.setTimeout(() => {
              window.dispatchEvent(new Event('securepass:guide-open-new-credential'));
            }, 80);
          }}
          onCurrentStepChange={setGuideCurrentStep}
        />
      )}

      {unlocked && guideActive && guideHiddenForNow && !showSyncModal && (
        <div className="fixed bottom-4 right-4 z-30">
          <button
            onClick={() => setGuideHiddenForNow(false)}
            className="px-3 py-2 rounded-xl border border-accent-edge bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 active:scale-95 transition-all duration-100"
          >
            Resume Setup Guide
          </button>
        </div>
      )}

      {/* Sync setup modal — accessible from the sidebar Cloud button */}
      {showSyncModal && (
        <div
          ref={syncModalRef}
          className="fixed inset-0 z-40 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeSyncModal(); }}
        >
          <div className="w-full max-w-[560px] [animation:fadeSlideUp_0.2s_ease-out_both]">
            <OnboardingScreen
              asModal
              initialMode={onboardingInitialMode}
              initialSyncConfig={syncInvitePrefill}
              onCancel={closeSyncModal}
              onComplete={(mode) => {
                localStorage.setItem('setting-sync-mode', mode);
                window.dispatchEvent(new CustomEvent('securepass:sync-mode-changed', { detail: { mode } }));
                setSyncMode(mode);
                closeSyncModal();
              }}
            />
          </div>
        </div>
      )}

      {/* Lock transition overlay — fixed, on top of everything */}
      {locking && (
        <LockTransition
          onLock={() => setUnlocked(false)}
          onDone={() => setLocking(false)}
        />
      )}

    </div>
  );
}

export default App;
