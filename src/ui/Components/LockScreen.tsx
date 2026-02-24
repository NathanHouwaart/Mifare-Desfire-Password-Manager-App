import { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Delete } from 'lucide-react';

const PIN_HASH_KEY = 'app-pin-hash';
const PIN_LENGTH = 6;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen = ({ onUnlock }: LockScreenProps) => {
  const [storedHash] = useState(() => localStorage.getItem(PIN_HASH_KEY));
  const isSettingPin = !storedHash;

  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Entrance animation — deferred one frame so initial opacity-0 class renders first
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const triggerShake = (msg: string) => {
    setError(msg);
    setPin('');
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleComplete = async (entered: string) => {
    if (isSettingPin) {
      if (phase === 'enter') {
        setFirstPin(entered);
        setPhase('confirm');
        setPin('');
      } else {
        if (entered === firstPin) {
          const hash = await sha256(entered);
          localStorage.setItem(PIN_HASH_KEY, hash);
          setUnlocking(true);
          setTimeout(() => onUnlock(), 800);
        } else {
          setPhase('enter');
          setFirstPin('');
          triggerShake("PINs don't match — try again");
        }
      }
    } else {
      const hash = await sha256(entered);
      if (hash === storedHash) {
        setUnlocking(true);
        setTimeout(() => onUnlock(), 800);
      } else {
        triggerShake('Incorrect PIN');
      }
    }
  };

  const handleDigit = (d: string) => {
    if (pin.length >= PIN_LENGTH || unlocking) return;
    setError('');
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) handleComplete(next);
  };

  const handleBackspace = () => {
    if (unlocking) return;
    setError('');
    setPin(p => p.slice(0, -1));
  };

  // Latest-ref pattern: stable keyboard listener that always invokes the current handler
  const handleDigitRef = useRef(handleDigit);
  const handleBackspaceRef = useRef(handleBackspace);
  useEffect(() => { handleDigitRef.current = handleDigit; });
  useEffect(() => { handleBackspaceRef.current = handleBackspace; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) handleDigitRef.current(e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete') handleBackspaceRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = isSettingPin
    ? (phase === 'enter' ? 'Set a PIN' : 'Confirm PIN')
    : 'Enter PIN';

  const subtitle = isSettingPin
    ? (phase === 'enter'
        ? 'Choose a 6-digit PIN to secure your vault'
        : 'Enter your PIN again to confirm')
    : 'Enter your PIN to unlock the vault';

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-page">
      <div
        className={`flex flex-col items-center gap-5 transition-[opacity,transform] duration-500 ease-out
          ${!mounted && !unlocking ? 'opacity-0 translate-y-8' : ''}
          ${mounted && !unlocking ? 'opacity-100 translate-y-0' : ''}
          ${unlocking ? 'opacity-0 -translate-y-6 scale-105' : ''}
          ${shake ? 'shake' : ''}`}
        style={unlocking ? { transitionDelay: '900ms' } : undefined}
      >
        {/* ── App branding ── */}
        <div className="flex flex-col items-center gap-4 mb-2">
          {/* Shield icon — gradient tile with unlock animations */}
          <div className="relative flex items-center justify-center">
            {/* Expanding burst ring on unlock */}
            {unlocking && (
              <div className="absolute inset-[-10px] rounded-[32px] border-2 border-ok/65
                              animate-[unlockBurst_1.0s_ease-out_forwards]" />
            )}
            {/* Spinning dashed halo on unlock */}
            {unlocking && (
              <div className="absolute w-32 h-32 rounded-full
                              border-2 border-dashed border-ok/35
                              animate-[lockRingSpin_1.6s_linear_infinite]" />
            )}
            <div
              className={`w-[84px] h-[84px] rounded-[26px] flex items-center justify-center
                          transition-all duration-300
                          shadow-[0_4px_32px_rgba(99,102,241,0.35)]
                          ${unlocking
                            ? 'bg-gradient-to-br from-green-500 to-emerald-600 animate-[unlockIconSpin_1.0s_cubic-bezier(0.34,1.56,0.64,1)_both]'
                            : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}
            >
              <ShieldCheck className="w-11 h-11 text-white drop-shadow-sm" />
            </div>
          </div>

          {/* App name + subtitle */}
          <div className="text-center">
            <h1 className="text-[28px] font-bold tracking-tight text-hi leading-tight">SecurePass</h1>
            <p className="text-[13px] text-lo mt-1 tracking-wide uppercase">NFC Password Manager</p>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="w-full max-w-[260px] border-t border-edge my-1" />

        {/* ── PIN flow title ── */}
        <div className="text-center">
          <p className="text-[18px] font-semibold text-hi">{title}</p>
          <p className="text-[14px] text-lo mt-1">{subtitle}</p>
        </div>

        {/* PIN dots */}
        <div className="flex gap-3">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-150 ${
                i < pin.length
                  ? 'w-3.5 h-3.5 bg-accent scale-125'
                  : 'w-3 h-3 bg-input border border-edge'
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        <div className="h-5">
          {error && <p className="text-[15px] text-err text-center">{error}</p>}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="w-16 h-16 rounded-2xl bg-card border border-edge
                         text-hi text-xl font-medium
                         hover:bg-input hover:border-edge2 hover:scale-105
                         active:scale-90 active:bg-input
                         transition-all duration-100 select-none"
            >
              {d}
            </button>
          ))}
          {/* Bottom row: empty / 0 / backspace */}
          <div />
          <button
            onClick={() => handleDigit('0')}
            className="w-16 h-16 rounded-2xl bg-card border border-edge
                       text-hi text-xl font-medium
                       hover:bg-input hover:border-edge2 hover:scale-105
                       active:scale-90 active:bg-input
                       transition-all duration-100 select-none"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="w-16 h-16 rounded-2xl bg-card border border-edge
                       text-lo flex items-center justify-center
                       hover:bg-input hover:border-edge2 hover:text-bright hover:scale-105
                       active:scale-90 active:bg-input
                       transition-all duration-100 select-none"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

      </div>
    </div>
  );
};
