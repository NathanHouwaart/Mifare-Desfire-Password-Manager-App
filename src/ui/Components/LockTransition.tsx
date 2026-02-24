import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

interface LockTransitionProps {
  /** Called mid-animation — triggers setUnlocked(false) so LockScreen renders behind the overlay */
  onLock: () => void;
  /** Called when the overlay has fully faded out — remove it from the tree */
  onDone: () => void;
}

export const LockTransition = ({ onLock, onDone }: LockTransitionProps) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Deferred one frame so opacity-0 renders before the enter transition fires
    const id = requestAnimationFrame(() => setVisible(true));
    // At 580ms: trigger setUnlocked(false) — LockScreen renders beneath the overlay
    const t1 = setTimeout(() => onLock(), 580);
    // At 630ms: start fade-out (300ms CSS transition → fully gone at ~930ms)
    const t2 = setTimeout(() => setVisible(false), 630);
    // At 950ms: unmount the overlay
    const t3 = setTimeout(() => onDone(), 950);
    return () => { cancelAnimationFrame(id); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onLock, onDone]);

  return (
    <div
      className={`fixed inset-0 z-[150] flex flex-col items-center justify-center
                  bg-page/92 backdrop-blur-lg
                  transition-opacity duration-300 ease-in-out
                  ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* ── Rings + icon ─────────────────────────────────── */}
      <div className="relative flex items-center justify-center">

        {/* Outer slow-spinning dashed ring */}
        <div className="absolute w-44 h-44 rounded-full
                        border-2 border-dashed border-indigo-400/25
                        animate-[lockRingSpin_3s_linear_infinite]" />

        {/* Middle pulsing ring */}
        <div className="absolute w-32 h-32 rounded-full
                        border border-indigo-500/20
                        animate-[lockRingPulse_1.4s_ease-in-out_infinite]" />

        {/* Fast inner counter-spin ring */}
        <div className="absolute w-[106px] h-[106px] rounded-full
                        border border-indigo-400/15
                        animate-[lockRingSpinRev_1.8s_linear_infinite]" />

        {/* Icon tile */}
        <div
          className={`relative w-[88px] h-[88px] rounded-[28px]
                      bg-gradient-to-br from-indigo-500 to-purple-600
                      flex items-center justify-center
                      shadow-[0_6px_48px_rgba(99,102,241,0.55)]
                      transition-all duration-300
                      ${visible ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}
        >
          <ShieldCheck className="w-11 h-11 text-white" />
        </div>
      </div>

      {/* ── Text ─────────────────────────────────────────── */}
      <div
        className={`mt-9 text-center transition-all duration-300 delay-100
                    ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      >
        <p className="text-[20px] font-semibold text-hi tracking-tight">Securing vault…</p>
        <p className="text-[14px] text-lo mt-1.5 tracking-wide">Locking your passwords</p>
      </div>
    </div>
  );
};
