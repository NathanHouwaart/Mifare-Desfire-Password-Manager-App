import { useCallback, useEffect, useState } from 'react';
import { Delete, ShieldCheck } from 'lucide-react';

const PIN_HASH_KEY = 'app-pin-hash';
const PIN_LENGTH = 6;
const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen = ({ onUnlock }: LockScreenProps) => {
  const [storedHash] = useState(() => localStorage.getItem(PIN_HASH_KEY));
  const isSettingPin = !storedHash;
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);

  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const refreshSyncStatus = async () => {
      try {
        const status = await window.electron['sync:getStatus']();
        setSyncStatus(status);
      } catch {
        setSyncStatus(null);
      }
    };
    void refreshSyncStatus();

    const onSyncModeChanged = () => {
      void refreshSyncStatus();
    };
    window.addEventListener('securepass:sync-mode-changed', onSyncModeChanged);
    return () => {
      window.removeEventListener('securepass:sync-mode-changed', onSyncModeChanged);
    };
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

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

  const handleComplete = useCallback(async (entered: string) => {
    if (isSettingPin) {
      if (phase === 'enter') {
        setFirstPin(entered);
        setPhase('confirm');
        setPin('');
        return;
      }

      if (entered === firstPin) {
        const hash = await sha256(entered);
        localStorage.setItem(PIN_HASH_KEY, hash);
        finishUnlock();
      } else {
        setPhase('enter');
        setFirstPin('');
        triggerShake('PINs do not match - try again');
      }
      return;
    }

    const hash = await sha256(entered);
    if (hash === storedHash) finishUnlock();
    else triggerShake('Incorrect PIN');
  }, [finishUnlock, firstPin, isSettingPin, phase, storedHash, triggerShake]);

  const handleDigit = useCallback((digit: string) => {
    if (unlocking) return;
    setError('');
    setPin((current) => {
      if (current.length >= PIN_LENGTH) return current;
      const next = current + digit;
      if (next.length === PIN_LENGTH) void handleComplete(next);
      return next;
    });
  }, [handleComplete, unlocking]);

  const handleBackspace = useCallback(() => {
    if (unlocking) return;
    setError('');
    setPin((value) => value.slice(0, -1));
  }, [unlocking]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [handleBackspace, handleDigit]);

  const title = isSettingPin
    ? (phase === 'enter' ? 'Set a PIN' : 'Confirm PIN')
    : 'Enter PIN';

  const subtitle = isSettingPin
    ? (phase === 'enter'
      ? 'Choose a 6-digit PIN to secure your vault.'
      : 'Enter your PIN again to finish setup.')
    : 'Enter your 6-digit PIN to unlock the vault.';

  const syncCtaLabel = syncStatus?.configured
    ? (syncStatus.loggedIn ? 'Change Sync Account' : 'Login To Sync')
    : 'Setup Synced Account';

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-page">
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
          className={`w-full max-w-[430px] transition-[opacity,transform] duration-500 ease-out
            ${!mounted && !unlocking ? 'translate-y-6 opacity-0' : ''}
            ${mounted && !unlocking ? 'translate-y-0 opacity-100' : ''}
            ${unlocking ? 'scale-[0.97] opacity-0' : ''}
            ${shake ? 'shake' : ''}`}
        >
          <div className="overflow-hidden rounded-[30px] border border-edge bg-card/90 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="border-b border-edge/80 px-6 pb-4 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex items-center gap-3">
                  <div className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center">
                    {!unlocking && (
                      <div className="absolute -inset-[2px] overflow-hidden rounded-[20px]">
                        <div
                          className="absolute -left-1/2 -top-1/2 h-[200%] w-[200%] animate-[spin_5s_linear_infinite]"
                          style={{
                            background: 'conic-gradient(from 0deg, transparent 0%, rgba(99,102,241,0.55) 25%, rgba(168,85,247,0.75) 50%, rgba(99,102,241,0.55) 75%, transparent 100%)',
                          }}
                        />
                      </div>
                    )}
                    {unlocking && (
                      <div className="absolute inset-[-9px] rounded-[24px] border-2 border-ok/65 animate-[unlockBurst_1.0s_ease-out_forwards]" />
                    )}
                    {unlocking && (
                      <div className="absolute h-24 w-24 rounded-full border-2 border-dashed border-ok/35 animate-[lockRingSpin_1.4s_linear_infinite]" />
                    )}
                    <div
                      className={`relative z-10 flex h-[64px] w-[64px] items-center justify-center rounded-[20px]
                        shadow-[0_4px_32px_rgba(99,102,241,0.35)] transition-all duration-300
                        ${unlocking
                          ? 'bg-gradient-to-br from-green-500 to-emerald-600 animate-[unlockIconSpin_1.0s_cubic-bezier(0.34,1.56,0.64,1)_both]'
                          : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}
                    >
                      <ShieldCheck className="h-9 w-9 text-white drop-shadow-sm" />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight text-hi">SecurePass</h1>
                    <p className="mt-0.5 truncate text-[12px] uppercase tracking-wide text-lo">NFC Password Manager</p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular-nums text-[25px] font-semibold leading-tight text-hi">
                    {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="mt-1 text-[12px] text-lo">
                    {clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>

              <div className="mt-4 align-middle text-center">
                <p className="text-[19px] font-semibold leading-tight text-hi">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-lo">{subtitle}</p>
              </div>
            </div>

            <div className="px-6 pb-6 pt-5">
              <div className="mb-3 flex items-center justify-center gap-2.5">
                {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                  <div
                    key={index}
                    className={`rounded-full transition-all duration-150 ${
                      index < pin.length
                        ? 'h-3.5 w-3.5 scale-110 bg-accent'
                        : 'h-3 w-3 border border-edge bg-input'
                    }`}
                  />
                ))}
              </div>

              <div className="mb-3 h-5 text-center">
                {error && <p className="text-[14px] text-err">{error}</p>}
              </div>

              {!unlocking && (
                <div className="mb-4 flex justify-center">
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('securepass:open-sync-wizard', { detail: { mode: 'synced' } }));
                    }}
                    className="px-3 py-2 rounded-lg text-[12px] font-medium border text-lo border-edge bg-input hover:opacity-90 transition-all duration-100"
                  >
                    {syncCtaLabel}
                  </button>
                </div>
              )}

              <div className="mx-auto grid w-full max-w-[260px] grid-cols-3 gap-2.5">
                {NUMBER_KEYS.map((digit) => (
                  <button
                    key={digit}
                    onClick={() => handleDigit(digit)}
                    disabled={unlocking}
                    className="aspect-square w-full rounded-xl border border-edge bg-well text-[22px] font-medium text-hi
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
                  disabled={unlocking}
                  className="aspect-square w-full rounded-xl border border-edge bg-well text-[22px] font-medium text-hi
                             transition-all duration-100 select-none
                             hover:scale-[1.02] hover:border-edge2 hover:bg-input
                             active:scale-[0.96] active:bg-input
                             disabled:opacity-40"
                >
                  0
                </button>
                <button
                  onClick={handleBackspace}
                  disabled={unlocking}
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
            </div>

            <div className="border-t border-edge/80 px-6 py-3">
              <p className="text-center text-[11px] text-dim">v0.1.0 - Secured by MIFARE DESFire EV2</p>
            </div>
          </div>

          <p className="mt-4 text-center text-[12px] text-dim">SecurePass - NFC Password Manager</p>
        </div>
      </div>
    </div>
  );
};
