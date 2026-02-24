import { Zap } from 'lucide-react';

interface DebugVersionCardProps {
  isConnected:  boolean;
  debugVersion: string | null;
  loading:      boolean;
  stale:        boolean;
  onGetVersion: () => void;
}

export const DebugVersionCard = ({
  isConnected, debugVersion, loading, stale, onGetVersion,
}: DebugVersionCardProps) => (
  <div className="bg-card border border-edge rounded-2xl p-5 flex flex-col">

    {/* Header */}
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-xl bg-warn-soft border border-warn-edge
                      flex items-center justify-center shrink-0">
        <Zap className="w-4 h-4 text-warn" />
      </div>
      <div>
        <p className="text-[15px] font-semibold text-hi">Debug Version</p>
        <p className="text-[13px] text-lo mt-0.5">Application build metadata</p>
      </div>
    </div>

    {/* Output area */}
    <div className="flex-1 mb-4 min-h-[58px] px-4 py-3 bg-well border border-edge
                    rounded-xl flex items-center">
      {loading || stale ? (
        <div className="w-full space-y-2">
          <div className="h-3 bg-input rounded-lg animate-pulse w-2/3" />
          <div className="h-3 bg-input rounded-lg animate-pulse w-5/12" />
        </div>
      ) : debugVersion ? (
        <span className="font-mono text-[14px] text-bright leading-relaxed">{debugVersion}</span>
      ) : (
        <span className="text-[14px] text-dim italic">Connect and query to read version</span>
      )}
    </div>

    <button
      onClick={onGetVersion}
      disabled={!isConnected || loading}
      className="w-full py-2.5 rounded-xl text-[15px] font-medium text-warn
                 bg-warn-soft border border-warn-edge hover:opacity-80 active:scale-[0.98]
                 disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                 disabled:cursor-not-allowed transition-all duration-150"
    >
      {loading ? 'Reading…' : 'Get Debug Version'}
    </button>
  </div>
);
