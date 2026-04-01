import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, Loader2, ShieldCheck, X } from 'lucide-react';

const PIN_LENGTH = 6;
const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const DESTRUCTIVE_RESET_PHRASE = 'DELETE MY VAULT';

type PinStatus = 'loading' | 'configured' | 'missing';
type RecoveryStep = 'intro' | 'account' | 'set-pin' | 'cant-access' | 'confirm-reset';

function formatRetryDelay(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function digitsOnly(value: string, maxLength = PIN_LENGTH): string {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

interface LockScreenProps {
  onUnlock: () => void;
  mode?: 'auto' | 'setup' | 'unlock';
  onBackToAccountSetup?: () => void;
}

export const LockScreen = ({ onUnlock, mode = 'auto', onBackToAccountSetup }: LockScreenProps) => {
  const [appVersion, setAppVersion] = useState<string>('...');
  const [pinStatus, setPinStatus] = useState<PinStatus>(
    mode === 'setup' ? 'missing' : mode === 'unlock' ? 'configured' : 'loading'
  );
  const isSettingPin = mode === 'setup' || (mode === 'auto' && pinStatus === 'missing');
  const isLoadingPinStatus = mode === 'auto' && pinStatus === 'loading';

  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>('intro');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryCapabilitiesLoading, setRecoveryCapabilitiesLoading] = useState(false);
  const [recoveryAccountRecoveryAvailable, setRecoveryAccountRecoveryAvailable] = useState(false);
  const [recoveryDestructiveResetAvailable, setRecoveryDestructiveResetAvailable] = useState(true);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryMfaCode, setRecoveryMfaCode] = useState('');
  const [recoveryNewPin, setRecoveryNewPin] = useState('');
  const [recoveryConfirmPin, setRecoveryConfirmPin] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [recoveryResetConfirmText, setRecoveryResetConfirmText] = useState('');
  const lastAutoSubmittedPinRef = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.electron['app:getVersion']()
      .then((version) => {
        if (cancelled) return;
        setAppVersion(version);
      })
      .catch(() => {
        if (cancelled) return;
        setAppVersion('Unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (mode !== 'auto') {
      setPinStatus(mode === 'setup' ? 'missing' : 'configured');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const hasPin = await window.electron['pin:has']();
        if (!cancelled) setPinStatus(hasPin ? 'configured' : 'missing');
      } catch {
        // Fail closed to setup mode if pin status cannot be loaded.
        if (!cancelled) setPinStatus('missing');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const triggerShake = useCallback((message: string) => {
    setError(message);
    setPin('');
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }, []);

  const finishUnlock = useCallback(() => {
    setUnlocking(true);
    setTimeout(() => onUnlock(), 720);
  }, [onUnlock]);

  const resetRecoveryForm = useCallback(() => {
    setRecoveryStep('intro');
    setRecoveryError('');
    setRecoveryCapabilitiesLoading(false);
    setRecoveryAccountRecoveryAvailable(false);
    setRecoveryDestructiveResetAvailable(true);
    setRecoveryPassword('');
    setRecoveryMfaCode('');
    setRecoveryNewPin('');
    setRecoveryConfirmPin('');
    setRecoveryToken('');
    setRecoveryResetConfirmText('');
  }, []);

  const closeRecoveryModal = useCallback(() => {
    if (recoveryBusy) return;
    setRecoveryOpen(false);
    resetRecoveryForm();
  }, [recoveryBusy, resetRecoveryForm]);

  const openRecoveryModal = useCallback(async () => {
    if (isSettingPin || isLoadingPinStatus || unlocking || recoveryBusy) return;
    setRecoveryOpen(true);
    resetRecoveryForm();
    setRecoveryCapabilitiesLoading(true);
    try {
      const capabilities = await window.electron['pin:recovery:capabilities']();
      setRecoveryAccountRecoveryAvailable(capabilities.accountRecoveryAvailable);
      setRecoveryDestructiveResetAvailable(capabilities.destructiveResetAvailable);
      setRecoveryStep(capabilities.accountRecoveryAvailable ? 'intro' : 'cant-access');
    } catch {
      setRecoveryAccountRecoveryAvailable(false);
      setRecoveryDestructiveResetAvailable(true);
      setRecoveryStep('cant-access');
      setRecoveryError('Could not load recovery options. You can still use destructive reset.');
    } finally {
      setRecoveryCapabilitiesLoading(false);
    }
  }, [isLoadingPinStatus, isSettingPin, recoveryBusy, resetRecoveryForm, unlocking]);

  const handleRecoveryAccountSubmit = useCallback(async () => {
    if (recoveryBusy) return;

    if (!recoveryAccountRecoveryAvailable) {
      setRecoveryStep('cant-access');
      setRecoveryError('Secure account recovery is unavailable on this device.');
      return;
    }
    if (recoveryPassword.trim().length === 0) {
      setRecoveryError('Enter your sync account password to continue.');
      return;
    }

    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const startPayload: PinRecoveryStartDto = {};
      if (recoveryPassword.trim().length > 0) {
        startPayload.password = recoveryPassword.trim();
      }
      if (recoveryMfaCode.trim().length > 0) {
        startPayload.mfaCode = recoveryMfaCode.trim();
      }

      const startResult = await window.electron['pin:recovery:start'](startPayload);
      if (!startResult.ok) {
        if (startResult.reason === 'NO_PIN') {
          setRecoveryOpen(false);
          resetRecoveryForm();
          setPinStatus('missing');
          setPhase('enter');
          setFirstPin('');
          triggerShake('No PIN found - create a new PIN');
          return;
        }
        if (startResult.reason === 'NO_SECURE_RECOVERY') {
          setRecoveryStep('cant-access');
          setRecoveryError(startResult.message);
          return;
        }
        if (startResult.reason === 'SYNC_PASSWORD_REQUIRED') {
          setRecoveryError('Enter your sync account password to continue.');
          return;
        }
        if (startResult.reason === 'MFA_REQUIRED') {
          setRecoveryError('Authenticator code required. Enter your 6-digit MFA code.');
          return;
        }
        if (startResult.reason === 'INVALID_MFA_CODE') {
          setRecoveryError('Invalid MFA code.');
          return;
        }
        setRecoveryError(startResult.message);
        return;
      }

      setRecoveryToken(startResult.token);
      setRecoveryError('');
      setRecoveryStep('set-pin');
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecoveryBusy(false);
    }
  }, [
    recoveryBusy,
    recoveryMfaCode,
    recoveryPassword,
    resetRecoveryForm,
    recoveryAccountRecoveryAvailable,
    triggerShake,
  ]);

  const handleRecoveryPinSubmit = useCallback(async () => {
    if (recoveryBusy) return;

    if (recoveryNewPin.length !== PIN_LENGTH) {
      setRecoveryError('New PIN must be exactly 6 digits.');
      return;
    }
    if (recoveryConfirmPin.length !== PIN_LENGTH) {
      setRecoveryError('Confirm your new 6-digit PIN.');
      return;
    }
    if (recoveryNewPin !== recoveryConfirmPin) {
      setRecoveryError("New PIN entries don't match.");
      return;
    }
    if (!recoveryToken) {
      setRecoveryStep(recoveryAccountRecoveryAvailable ? 'account' : 'cant-access');
      setRecoveryError('Account verification expired. Verify your account again.');
      return;
    }

    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const completeResult = await window.electron['pin:recovery:complete']({
        token: recoveryToken,
        newPin: recoveryNewPin,
      });
      if (!completeResult.ok) {
        if (completeResult.reason === 'INVALID_NEW_PIN') {
          setRecoveryError('New PIN must be exactly 6 digits.');
          return;
        }
        setRecoveryToken('');
        setRecoveryStep(recoveryAccountRecoveryAvailable ? 'account' : 'cant-access');
        setRecoveryError('Recovery verification expired. Verify your account again.');
        return;
      }

      setRecoveryOpen(false);
      resetRecoveryForm();
      setPin('');
      setError('');
      setPinStatus('configured');
      finishUnlock();
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecoveryBusy(false);
    }
  }, [
    finishUnlock,
    recoveryBusy,
    recoveryConfirmPin,
    recoveryNewPin,
    recoveryToken,
    resetRecoveryForm,
    recoveryAccountRecoveryAvailable,
  ]);

  const handleRecoveryDestructiveReset = useCallback(async () => {
    if (recoveryBusy) return;
    if (!recoveryDestructiveResetAvailable) {
      setRecoveryError('Destructive reset is unavailable right now.');
      return;
    }
    if (recoveryResetConfirmText.trim() !== DESTRUCTIVE_RESET_PHRASE) {
      setRecoveryError(`Type "${DESTRUCTIVE_RESET_PHRASE}" to confirm.`);
      return;
    }

    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      localStorage.removeItem('app-onboarding-complete');
      await window.electron['pin:recovery:destructiveReset']();
      await window.electron['app:relaunch']();
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecoveryBusy(false);
    }
  }, [recoveryBusy, recoveryDestructiveResetAvailable, recoveryResetConfirmText]);

  const handleComplete = useCallback(async (entered: string) => {
    if (isSettingPin) {
      if (phase === 'enter') {
        setFirstPin(entered);
        setPhase('confirm');
        setPin('');
        return;
      }

      if (entered === firstPin) {
        try {
          await window.electron['pin:set'](entered);
          setPinStatus('configured');
          finishUnlock();
        } catch (err) {
          triggerShake(err instanceof Error ? err.message : String(err));
        }
      } else {
        setPhase('enter');
        setFirstPin('');
        triggerShake("Those didn't match - start again");
      }
      return;
    }

    try {
      const result = await window.electron['pin:verify'](entered);
      if (result.ok) {
        finishUnlock();
        return;
      }

      if (result.reason === 'LOCKED') {
        triggerShake(`Too many attempts - try again in ${formatRetryDelay(result.retryAfterMs)}`);
        return;
      }

      if (result.attemptsRemaining === 0) {
        setPinStatus('missing');
        setPhase('enter');
        setFirstPin('');
        triggerShake('No PIN found - create a new PIN');
        return;
      }

      triggerShake(
        `Incorrect PIN - ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left`
      );
    } catch (err) {
      triggerShake(err instanceof Error ? err.message : String(err));
    }
  }, [finishUnlock, firstPin, isSettingPin, phase, triggerShake]);

  const handleDigit = useCallback((digit: string) => {
    if (unlocking || recoveryOpen || isLoadingPinStatus) return;
    setError('');
    setPin((current) => {
      if (current.length >= PIN_LENGTH) return current;
      return current + digit;
    });
  }, [isLoadingPinStatus, recoveryOpen, unlocking]);

  const handleBackspace = useCallback(() => {
    if (unlocking || recoveryOpen || isLoadingPinStatus) return;
    setError('');
    setPin((value) => value.slice(0, -1));
  }, [isLoadingPinStatus, recoveryOpen, unlocking]);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH) {
      lastAutoSubmittedPinRef.current = null;
      return;
    }
    if (lastAutoSubmittedPinRef.current === pin) {
      return;
    }
    lastAutoSubmittedPinRef.current = pin;
    void handleComplete(pin);
  }, [handleComplete, pin]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && recoveryOpen) {
        event.preventDefault();
        closeRecoveryModal();
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget = target !== null && (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      );
      if (isTypingTarget || recoveryOpen) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        handleDigit(event.key);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        handleBackspace();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeRecoveryModal, handleBackspace, handleDigit, recoveryOpen]);

  const title = isLoadingPinStatus
    ? 'Preparing lock screen'
    : isSettingPin
    ? (phase === 'enter' ? 'Create your unlock PIN' : 'Confirm your PIN')
    : 'Enter your PIN';

  const subtitle = isLoadingPinStatus
    ? 'Checking PIN status...'
    : isSettingPin
    ? (phase === 'enter'
      ? 'Choose 6 digits you\'ll type each time SecurePass NFC opens.'
      : 'Re-enter the same 6 digits to confirm.')
    : 'Enter your 6-digit PIN to unlock SecurePass NFC.';

  return (
    <div role="main" className="relative h-screen w-screen overflow-hidden bg-page">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 72% 58% at 50% 24%, rgba(99,102,241,0.12) 0%, transparent 72%),
            radial-gradient(circle at 88% 14%, rgba(99,102,241,0.1) 0%, transparent 32%)
          `,
        }}
      />

      <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div
          className={`w-full max-w-[420px] transition-[opacity,transform] duration-500 ease-out
            ${!mounted && !unlocking ? 'translate-y-6 opacity-0' : ''}
            ${mounted && !unlocking ? 'translate-y-0 opacity-100' : ''}
            ${unlocking ? 'scale-[0.97] opacity-0' : ''}
            ${shake ? 'shake' : ''}`}
        >
          <div className="overflow-hidden rounded-[30px] border border-edge bg-card/90 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="border-b border-edge/80 px-5 pb-3 pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex items-center gap-3">
                  <div className="relative flex h-[62px] w-[62px] shrink-0 items-center justify-center">
                    {!unlocking && (
                      <div className="absolute -inset-[2px] overflow-hidden rounded-[18px]">
                        <div
                          className="absolute -left-1/2 -top-1/2 h-[200%] w-[200%] animate-[spin_5s_linear_infinite]"
                          style={{
                            background: 'conic-gradient(from 0deg, transparent 0%, rgba(99,102,241,0.55) 25%, rgba(168,85,247,0.75) 50%, rgba(99,102,241,0.55) 75%, transparent 100%)',
                          }}
                        />
                      </div>
                    )}
                    {unlocking && (
                      <div className="absolute inset-[-8px] rounded-[20px] border-2 border-ok/65 animate-[unlockBurst_1.0s_ease-out_forwards]" />
                    )}
                    {unlocking && (
                      <div className="absolute h-20 w-20 rounded-full border-2 border-dashed border-ok/35 animate-[lockRingSpin_1.4s_linear_infinite]" />
                    )}
                    <div
                      className={`relative z-10 flex h-[58px] w-[58px] items-center justify-center rounded-[18px]
                        shadow-[0_4px_32px_rgba(99,102,241,0.35)] transition-all duration-300
                        ${unlocking
                          ? 'bg-gradient-to-br from-green-500 to-emerald-600 animate-[unlockIconSpin_1.0s_cubic-bezier(0.34,1.56,0.64,1)_both]'
                          : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}
                    >
                      <ShieldCheck className="h-8 w-8 text-white drop-shadow-sm" />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight text-hi">SecurePass NFC</h1>
                    <p className="mt-0.5 truncate text-[13px] uppercase tracking-wide text-lo">NFC Password Manager</p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular-nums text-[23px] font-semibold leading-tight text-hi">
                    {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="mt-1 text-[13px] text-lo">
                    {clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>

              <div className="mt-3 align-middle text-center">
                <p className="text-[18px] font-semibold leading-tight text-hi">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-lo">{subtitle}</p>
              </div>
            </div>

            <div className="px-5 pb-5 pt-4">
              {isSettingPin && phase === 'enter' && (
                <div className="mb-4 rounded-xl border border-accent-edge/50 bg-accent-soft px-3.5 py-2.5 text-[13px] text-lo text-center leading-relaxed">
                  This PIN unlocks the app each time it opens. Recovery requires your account if you forget it.
                </div>
              )}

              <div className="mb-4 flex items-center justify-center gap-2.5">
                {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                  <div
                    key={index}
                    className={`h-3.5 w-3.5 rounded-full border transition-colors duration-150 ${
                      index < pin.length
                        ? 'border-accent-edge bg-accent'
                        : 'border-edge bg-input'
                    }`}
                  />
                ))}
              </div>

              <div className="mb-3 h-5 text-center">
                {error && <p className="text-[14px] text-err">{error}</p>}
              </div>

              <div className="mx-auto grid w-full max-w-[270px] grid-cols-3 gap-2.5">
                {NUMBER_KEYS.map((digit) => (
                  <button
                    key={digit}
                    onClick={() => handleDigit(digit)}
                    disabled={unlocking || isLoadingPinStatus}
                    className="aspect-square w-full rounded-xl border border-edge bg-well text-[21px] font-medium text-hi
                               transition-all duration-100 select-none
                               hover:scale-[1.02] hover:border-edge2 hover:bg-input
                               active:scale-[0.96] active:bg-input
                               disabled:opacity-40"
                  >
                    {digit}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => handleDigit('0')}
                  disabled={unlocking || isLoadingPinStatus}
                  className="aspect-square w-full rounded-xl border border-edge bg-well text-[21px] font-medium text-hi
                             transition-all duration-100 select-none
                             hover:scale-[1.02] hover:border-edge2 hover:bg-input
                             active:scale-[0.96] active:bg-input
                             disabled:opacity-40"
                >
                  0
                </button>
                <button
                  onClick={handleBackspace}
                  disabled={unlocking || isLoadingPinStatus}
                  aria-label="Delete digit"
                  className="flex aspect-square w-full items-center justify-center rounded-xl border border-edge bg-well text-lo
                             transition-all duration-100 select-none
                             hover:scale-[1.02] hover:border-edge2 hover:bg-input hover:text-bright
                             active:scale-[0.96] active:bg-input
                             disabled:opacity-40"
                >
                  <Delete className="h-5 w-5" />
                </button>
              </div>

              {!isSettingPin && !isLoadingPinStatus && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => { void openRecoveryModal(); }}
                    disabled={unlocking || recoveryBusy}
                    className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-accent hover:opacity-90 active:scale-[0.98] transition-all duration-100 disabled:opacity-40"
                  >
                    Forgot PIN?
                  </button>
                </div>
              )}

              {isSettingPin && onBackToAccountSetup && !isLoadingPinStatus && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={onBackToAccountSetup}
                    disabled={unlocking}
                    className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-mid hover:text-hi active:scale-[0.98] transition-all duration-100 disabled:opacity-40"
                  >
                    Back To Account Setup
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-edge/80 px-6 py-3">
              <p className="text-center text-[11px] text-dim">v{appVersion} - Secured by MIFARE DESFire EV2</p>
            </div>
          </div>

          <p className="mt-4 text-center text-[13px] text-dim">SecurePass NFC Password Manager</p>
        </div>
      </div>

      {recoveryOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-edge bg-card shadow-2xl animate-[fadeSlideUp_0.2s_ease-out]">
            <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
              <div>
                <h2 className="text-[18px] font-semibold text-hi">
                  {recoveryStep === 'set-pin'
                    ? 'Set New PIN'
                    : recoveryStep === 'confirm-reset'
                      ? 'Confirm Destructive Reset'
                      : 'Recover Access'}
                </h2>
                <p className="mt-1 text-[13px] text-lo">
                  {recoveryStep === 'set-pin'
                    ? 'Choose a new 6-digit unlock PIN for this computer.'
                    : recoveryStep === 'confirm-reset'
                      ? 'This will erase local vault data and restart SecurePass NFC setup.'
                      : 'Recovering a lost PIN requires account verification. Card-only recovery is disabled.'}
                </p>
              </div>
              <button
                onClick={closeRecoveryModal}
                disabled={recoveryBusy}
                className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-dim hover:bg-input hover:text-hi active:scale-90 transition-all duration-100 disabled:opacity-40"
                aria-label="Close recovery dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              {recoveryCapabilitiesLoading && (
                <p className="text-[13px] text-dim">Loading recovery options...</p>
              )}

              {!recoveryCapabilitiesLoading && recoveryStep === 'intro' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-accent-edge bg-accent-soft p-3 text-[13px] text-lo">
                    Recover a forgotten PIN by verifying your sync account password and authenticator code (when enabled).
                  </div>
                  <div className="rounded-xl border border-edge bg-input p-3 text-[13px] text-lo">
                    If you cannot access your account, a destructive reset is available from the fallback flow.
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={closeRecoveryModal}
                      disabled={recoveryBusy}
                      className="flex-1 rounded-xl border border-edge bg-input py-2.5 text-[15px] font-medium text-lo transition-all duration-100 hover:text-hi active:scale-[0.98] disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryError('');
                        setRecoveryStep('account');
                      }}
                      disabled={recoveryBusy || !recoveryAccountRecoveryAvailable}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-solid py-2.5 text-[15px] font-medium text-white transition-all duration-100 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {!recoveryCapabilitiesLoading && recoveryStep === 'account' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleRecoveryAccountSubmit();
                  }}
                  className="space-y-3"
                >
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-lo">Sync Account Password</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={recoveryPassword}
                      onChange={(event) => setRecoveryPassword(event.target.value)}
                      className="rounded-xl border border-edge bg-input px-3.5 py-2.5 text-[15px] text-hi outline-none transition-colors focus:border-accent-edge"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-lo">Authenticator Code (if enabled)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={recoveryMfaCode}
                      onChange={(event) => setRecoveryMfaCode(digitsOnly(event.target.value, 6))}
                      className="rounded-xl border border-edge bg-input px-3.5 py-2.5 text-[15px] text-hi outline-none transition-colors focus:border-accent-edge"
                    />
                  </label>

                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryError('');
                        setRecoveryStep('intro');
                      }}
                      disabled={recoveryBusy}
                      className="flex-1 rounded-xl border border-edge bg-input py-2.5 text-[15px] font-medium text-lo transition-all duration-100 hover:text-hi active:scale-[0.98] disabled:opacity-40"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={recoveryBusy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-solid py-2.5 text-[15px] font-medium text-white transition-all duration-100 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {recoveryBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Verify Account
                    </button>
                  </div>

                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryError('');
                        setRecoveryStep('cant-access');
                      }}
                      disabled={recoveryBusy}
                      className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-accent hover:opacity-90 active:scale-[0.98] transition-all duration-100 disabled:opacity-40"
                    >
                      I can&apos;t access my account
                    </button>
                  </div>
                </form>
              )}

              {!recoveryCapabilitiesLoading && recoveryStep === 'set-pin' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleRecoveryPinSubmit();
                  }}
                  className="space-y-3"
                >
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-lo">New PIN</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={PIN_LENGTH}
                      value={recoveryNewPin}
                      onChange={(event) => setRecoveryNewPin(digitsOnly(event.target.value))}
                      className="rounded-xl border border-edge bg-input px-3.5 py-2.5 text-[15px] text-hi outline-none transition-colors focus:border-accent-edge"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-lo">Confirm New PIN</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={PIN_LENGTH}
                      value={recoveryConfirmPin}
                      onChange={(event) => setRecoveryConfirmPin(digitsOnly(event.target.value))}
                      className="rounded-xl border border-edge bg-input px-3.5 py-2.5 text-[15px] text-hi outline-none transition-colors focus:border-accent-edge"
                    />
                  </label>

                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryError('');
                        setRecoveryStep('account');
                      }}
                      disabled={recoveryBusy}
                      className="flex-1 rounded-xl border border-edge bg-input py-2.5 text-[15px] font-medium text-lo transition-all duration-100 hover:text-hi active:scale-[0.98] disabled:opacity-40"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={recoveryBusy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-solid py-2.5 text-[15px] font-medium text-white transition-all duration-100 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {recoveryBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Set New PIN
                    </button>
                  </div>
                </form>
              )}

              {!recoveryCapabilitiesLoading && recoveryStep === 'cant-access' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-err-edge bg-err-soft p-3 text-[13px] text-lo">
                    Without account verification, SecurePass NFC cannot safely recover your PIN. Card-only recovery is disabled.
                  </div>
                  <div className="rounded-xl border border-edge bg-input p-3 text-[13px] text-lo">
                    You can continue to destructive reset, which erases local vault data and restarts setup.
                  </div>
                  <div className="flex gap-3 pt-1">
                    {recoveryAccountRecoveryAvailable ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRecoveryError('');
                          setRecoveryStep('account');
                        }}
                        disabled={recoveryBusy}
                        className="flex-1 rounded-xl border border-edge bg-input py-2.5 text-[15px] font-medium text-lo transition-all duration-100 hover:text-hi active:scale-[0.98] disabled:opacity-40"
                      >
                        Back
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={closeRecoveryModal}
                        disabled={recoveryBusy}
                        className="flex-1 rounded-xl border border-edge bg-input py-2.5 text-[15px] font-medium text-lo transition-all duration-100 hover:text-hi active:scale-[0.98] disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryError('');
                        setRecoveryStep('confirm-reset');
                      }}
                      disabled={recoveryBusy || !recoveryDestructiveResetAvailable}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-err-edge bg-err-soft py-2.5 text-[15px] font-medium text-err transition-all duration-100 hover:bg-err/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {!recoveryCapabilitiesLoading && recoveryStep === 'confirm-reset' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleRecoveryDestructiveReset();
                  }}
                  className="space-y-3"
                >
                  <div className="rounded-xl border border-err-edge bg-err-soft p-3 text-[13px] text-lo">
                    This action permanently erases local vault data, local sync state, and the current PIN.
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-lo">
                      Type <span className="font-mono font-semibold text-err">{DESTRUCTIVE_RESET_PHRASE}</span> to continue
                    </span>
                    <input
                      type="text"
                      value={recoveryResetConfirmText}
                      onChange={(event) => setRecoveryResetConfirmText(event.target.value)}
                      className="rounded-xl border border-edge bg-input px-3.5 py-2.5 text-[15px] text-hi outline-none transition-colors focus:border-accent-edge"
                    />
                  </label>
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryError('');
                        setRecoveryStep('cant-access');
                      }}
                      disabled={recoveryBusy}
                      className="flex-1 rounded-xl border border-edge bg-input py-2.5 text-[15px] font-medium text-lo transition-all duration-100 hover:text-hi active:scale-[0.98] disabled:opacity-40"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={recoveryBusy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-err-edge bg-err-soft py-2.5 text-[15px] font-medium text-err transition-all duration-100 hover:bg-err/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {recoveryBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Erase and Restart
                    </button>
                  </div>
                </form>
              )}

              {recoveryError && (
                <p className="text-[13px] text-err">{recoveryError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
