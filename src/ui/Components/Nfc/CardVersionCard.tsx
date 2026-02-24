import { CreditCard } from 'lucide-react';

interface CardVersionCardProps {
  isConnected:  boolean;
  cardVersion:  CardVersionInfoDto | null;
  loading:      boolean;
  stale:        boolean;
  errorMsg:     string | null;
  onGetVersion: () => void;
}

const VersionRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <span className="text-[13px] text-lo shrink-0">{label}</span>
    <span className="font-mono text-[13px] text-bright text-right truncate">{value}</span>
  </div>
);

export const CardVersionCard = ({
  isConnected, cardVersion, loading, stale, errorMsg, onGetVersion,
}: CardVersionCardProps) => (
  <div className="bg-card border border-edge rounded-2xl p-5 flex flex-col">

    {/* Header */}
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-xl bg-warn-soft border border-warn-edge
                      flex items-center justify-center shrink-0">
        <CreditCard className="w-4 h-4 text-warn" />
      </div>
      <div>
        <p className="text-[15px] font-semibold text-hi">Card Version</p>
        <p className="text-[13px] text-lo mt-0.5">DESFire card info — card required</p>
      </div>
    </div>

    {/* Output area */}
    <div className="flex-1 mb-4 min-h-[90px] px-4 py-2 bg-well border border-edge rounded-xl">
      {loading || stale ? (
        <div className="space-y-2 py-2">
          <div className="h-3 bg-input rounded-lg animate-pulse w-2/3" />
          <div className="h-3 bg-input rounded-lg animate-pulse w-5/12" />
          <div className="h-3 bg-input rounded-lg animate-pulse w-3/4" />
          <div className="h-3 bg-input rounded-lg animate-pulse w-1/2" />
        </div>
      ) : errorMsg ? (
        <div className="flex items-center min-h-[58px]">
          <span className="text-[14px] text-err leading-relaxed">{errorMsg}</span>
        </div>
      ) : cardVersion ? (
        <div className="divide-y divide-edge">
          <VersionRow label="Hardware Version" value={cardVersion.hwVersion || '—'} />
          <VersionRow label="Software Version" value={cardVersion.swVersion || '—'} />
          <VersionRow label="UID"              value={cardVersion.uidHex    || '—'} />
          <VersionRow label="Storage"          value={cardVersion.storage   || '—'} />
        </div>
      ) : (
        <div className="flex items-center min-h-[58px]">
          <span className="text-[14px] text-dim italic">Tap a DESFire card to read version</span>
        </div>
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
      {loading ? 'Reading…' : 'Get Card Version'}
    </button>
  </div>
);

