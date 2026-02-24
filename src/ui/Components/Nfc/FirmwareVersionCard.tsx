import { Download } from 'lucide-react';

interface FirmwareVersionCardProps {
  isConnected: boolean;
  firmware:    string | null;
  loading:     boolean;
  stale:       boolean;
  errorMsg:    string | null;
  onGetFirmware: () => void;
}

export const FirmwareVersionCard = ({
  isConnected, firmware, loading, stale, errorMsg, onGetFirmware,
}: FirmwareVersionCardProps) => (
  <div className="bg-card border border-edge rounded-2xl p-5 flex flex-col">

    {/* Header */}
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-xl bg-accent-soft border border-accent-edge
                      flex items-center justify-center shrink-0">
        <Download className="w-4 h-4 text-accent" />
      </div>
      <div>
        <p className="text-[15px] font-semibold text-hi">Firmware Version</p>
        <p className="text-[13px] text-lo mt-0.5">Query PN532 chip firmware</p>
      </div>
    </div>

    {/* Output area */}
    <div className="flex-1 mb-4 min-h-[58px] px-4 py-3 bg-well border border-edge
                    rounded-xl flex items-center">
      {loading || stale ? (
        <div className="w-full space-y-2">
          <div className="h-3 bg-input rounded-lg animate-pulse w-3/4" />
          <div className="h-3 bg-input rounded-lg animate-pulse w-5/12" />
        </div>
      ) : errorMsg ? (
        <span className="text-[14px] text-err leading-relaxed">{errorMsg}</span>
      ) : firmware ? (
        <span className="font-mono text-[14px] text-bright leading-relaxed">{firmware}</span>
      ) : (
        <span className="text-[14px] text-dim italic">Connect and query to read firmware</span>
      )}
    </div>

    <button
      onClick={onGetFirmware}
      disabled={!isConnected || loading}
      className="w-full py-2.5 rounded-xl text-[15px] font-medium text-white
                 bg-accent-solid hover:bg-accent-hover active:scale-[0.98]
                 disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                 disabled:cursor-not-allowed transition-all duration-150"
    >
      {loading ? 'Reading…' : 'Get Firmware Version'}
    </button>
  </div>
);
