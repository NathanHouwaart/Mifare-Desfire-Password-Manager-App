import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

export const SplashScreen = ({ onDone }: { onDone: () => void }) => {
  const [out, setOut] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setOut(true), 1900);   // start fade-out
    const t2 = setTimeout(() => onDone(),     2450);   // hand off to LockScreen
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center
                  bg-page select-none pointer-events-none
                  transition-opacity duration-500 ease-in-out
                  ${out ? 'opacity-0' : 'opacity-100'}`}
    >

      {/* ── Shield icon ──────────────────────────────────────────── */}
      <div className="animate-[splashIcon_0.7s_cubic-bezier(0.34,1.56,0.64,1)_both]">
        <div className="relative w-[88px] h-[88px]">
          {/* Expanding glow ring */}
          <div className="absolute inset-0 rounded-[28px] border-2 border-indigo-400/50
                          animate-[splashRing_1.6s_ease-out_0.8s_infinite]" />
          {/* Icon tile */}
          <div className="w-full h-full rounded-[28px]
                          bg-gradient-to-br from-indigo-500 to-purple-600
                          flex items-center justify-center
                          shadow-[0_8px_48px_rgba(99,102,241,0.55)]">
            <ShieldCheck className="w-12 h-12 text-white drop-shadow-sm" />
          </div>
        </div>
      </div>

      {/* ── App name + subtitle ──────────────────────────────────── */}
      <div className="animate-[splashFadeUp_0.5s_ease-out_0.55s_both] mt-7 text-center">
        <h1 className="text-[32px] font-bold tracking-tight text-hi">SecurePass</h1>
        <p className="text-[15px] text-lo mt-1.5 tracking-wide">NFC Password Manager</p>
      </div>

      {/* ── Loading dots ─────────────────────────────────────────── */}
      <div className="animate-[splashFadeUp_0.4s_ease-out_1s_both] mt-12 flex gap-2">
        {([0, 180, 360] as const).map(delay => (
          <span
            key={delay}
            style={{ animationDelay: `${delay}ms` }}
            className="w-[7px] h-[7px] rounded-full bg-indigo-400/60
                       animate-[splashDot_1.2s_ease-in-out_infinite]"
          />
        ))}
      </div>

    </div>
  );
};
