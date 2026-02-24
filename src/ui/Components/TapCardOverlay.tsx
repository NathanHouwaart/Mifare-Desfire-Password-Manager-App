import { X } from 'lucide-react';

interface TapCardOverlayProps {
  /** Line shown under "Tap Your Card", e.g. "to decrypt 'GitHub'" */
  message: string;
  /** Called when user clicks Cancel — the in-flight IPC call is left to
   *  resolve or reject on its own; the overlay simply unmounts. */
  onCancel: () => void;
}

/**
 * Full-screen overlay shown while a card-gated IPC call is in progress.
 * The parent is responsible for mounting/unmounting it based on async state.
 */
export const TapCardOverlay = ({ message, onCancel }: TapCardOverlayProps) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
    aria-modal="true"
    role="dialog"
    aria-label="Tap card to continue"
  >
    <div className="bg-card border border-edge rounded-2xl w-full max-w-sm shadow-2xl p-8
                    flex flex-col items-center gap-6 animate-[fadeSlideUp_0.2s_ease-out]">

      {/* Pulsing NFC rings + card icon */}
      <div className="relative w-24 h-24 flex items-center justify-center">
        {/* outer ring */}
        <span
          className="absolute inset-0 rounded-full border-2 border-accent opacity-30
                     animate-[pulseRing_2s_ease-out_infinite]"
        />
        {/* inner ring, slightly delayed */}
        <span
          className="absolute inset-3 rounded-full border-2 border-accent opacity-40
                     animate-[pulseRing_2s_ease-out_0.5s_infinite]"
        />
        {/* Icon circle */}
        <div className="w-16 h-16 rounded-full bg-accent-soft border border-accent-edge
                        flex items-center justify-center">
          {/* NFC / contactless wave icon — simple SVG */}
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
            className="w-8 h-8 text-accent"
          >
            {/* Card outline */}
            <rect x="2" y="5" width="20" height="14" rx="2" />
            {/* Three NFC arcs */}
            <path d="M12 12 a1 1 0 0 1 0-2" strokeWidth="0" fill="currentColor" />
            <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
            <path d="M9.5 8.5 a4 4 0 0 1 5 0" />
            <path d="M7 6.5  a7 7 0 0 1 10 0" />
          </svg>
        </div>
      </div>

      {/* Text */}
      <div className="text-center">
        <p className="text-[19px] font-semibold text-hi">Tap Your Card</p>
        <p className="text-[14px] text-lo mt-1.5 leading-relaxed max-w-[200px] mx-auto">
          {message}
        </p>
      </div>

      {/* Indeterminate shimmer progress bar */}
      <div className="w-full h-1 rounded-full bg-well overflow-hidden">
        <div
          className="h-full w-1/3 rounded-full bg-accent
                     animate-[shimmer_1.6s_linear_infinite]"
        />
      </div>

      {/* Cancel */}
      <button
        onClick={onCancel}
        className="flex items-center gap-1.5 text-[14px] text-lo hover:text-hi
                   transition-colors duration-100 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-accent-edge rounded"
      >
        <X className="w-4 h-4" />
        Cancel
      </button>
    </div>
  </div>
);
