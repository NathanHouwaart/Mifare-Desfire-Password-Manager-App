import { Cpu, ChevronDown, RefreshCw } from 'lucide-react';

interface ConnectionCardProps {
  isConnected:    boolean;
  port:           string;
  onPortChange:   (port: string) => void;
  availablePorts: ComPort[];
  portsLoading:   boolean;
  onFetchPorts:   () => void;
  statusMsg:      string;
  onConnect:      () => void;
  onDisconnect:   () => void;
}

export const ConnectionCard = ({
  isConnected, port, onPortChange, availablePorts,
  portsLoading, onFetchPorts, statusMsg, onConnect, onDisconnect,
}: ConnectionCardProps) => (
  <div className="bg-card border border-edge rounded-2xl p-5">

    {/* Status row */}
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-2.5">
        <span className={`w-3 h-3 rounded-full transition-all duration-300
                          ${isConnected ? 'bg-ok' : 'bg-err opacity-70'}`} />
        <span className={`text-[16px] font-medium transition-colors duration-300
                          ${isConnected ? 'text-ok' : 'text-lo'}`}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <Cpu className="w-5 h-5 text-dim" />
    </div>

    {/* COM port dropdown */}
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <label className="text-[15px] text-lo font-medium">COM Port</label>
        <button
          onClick={onFetchPorts}
          disabled={portsLoading || isConnected}
          className="flex items-center gap-1.5 text-[14px] text-accent
                     hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors duration-150 select-none"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${portsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <div className="relative">
        <select
          value={port}
          onChange={e => onPortChange(e.target.value)}
          disabled={isConnected || availablePorts.length === 0}
          className="w-full bg-input border border-edge text-hi text-[16px]
                     px-4 py-3 pr-11 rounded-xl outline-none appearance-none cursor-pointer
                     focus:border-accent-edge focus:ring-1 focus:ring-accent-soft
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-all duration-150"
        >
          {availablePorts.length === 0
            ? <option value="">No COM ports detected</option>
            : availablePorts.map(p => (
                <option key={p.path} value={p.path}>
                  {p.path}{p.manufacturer ? ` — ${p.manufacturer}` : ''}
                </option>
              ))
          }
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dim pointer-events-none" />
      </div>
    </div>

    {/* Connect / Disconnect buttons */}
    <div className="flex gap-3">
      <button
        onClick={onConnect}
        disabled={isConnected || !port}
        className="flex-1 py-3 rounded-xl text-[16px] font-medium text-white
                   bg-accent-solid hover:bg-accent-hover active:scale-[0.98]
                   disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                   disabled:cursor-not-allowed transition-all duration-150"
      >
        Connect
      </button>
      <button
        onClick={onDisconnect}
        disabled={!isConnected}
        className="flex-1 py-3 rounded-xl text-[16px] font-medium text-white
                   bg-err-solid hover:opacity-90 active:scale-[0.98]
                   disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                   disabled:cursor-not-allowed transition-all duration-150"
      >
        Disconnect
      </button>
    </div>

    {statusMsg && (
      <div className="mt-4 px-4 py-3 bg-input border border-edge rounded-xl
                      text-[15px] text-mid leading-relaxed">
        {statusMsg}
      </div>
    )}
  </div>
);
