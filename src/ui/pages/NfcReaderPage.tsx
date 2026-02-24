import { useState, useEffect, useCallback } from 'react';
import { Cpu, Terminal, ChevronDown, RefreshCw } from 'lucide-react';

interface NfcReaderPageProps {
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  isConnected: boolean;
  onConnectionChange: (connected: boolean) => void;
  terminalEnabled: boolean;
}

export const NfcReaderPage = ({ isTerminalOpen, onToggleTerminal, isConnected, onConnectionChange, terminalEnabled }: NfcReaderPageProps) => {
  const [port,           setPort]           = useState('');
  const [statusMsg,      setStatusMsg]      = useState('');
  const [availablePorts, setAvailablePorts] = useState<ComPort[]>([]);
  const [portsLoading,   setPortsLoading]   = useState(false);

  const fetchPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      const ports = await window.electron.listComPorts();
      setAvailablePorts(ports);
      setPort(prev => {
        // keep current selection if still available, else default to first
        if (prev && ports.some(p => p.path === prev)) return prev;
        return ports[0]?.path ?? '';
      });
    } catch {
      setAvailablePorts([]);
    } finally {
      setPortsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPorts(); }, [fetchPorts]);

  const handleConnect = async () => {
    if (!port) return;
    try {
      setStatusMsg('Connecting…');
      const result = await window.electron.connect(port);
      setStatusMsg(result);
      onConnectionChange(true);
    } catch (error: unknown) {
      setStatusMsg('Error: ' + (error instanceof Error ? error.message : String(error)));
      onConnectionChange(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setStatusMsg('Disconnecting…');
      const result = await window.electron.disconnect();
      setStatusMsg(result ? 'Disconnected successfully' : 'Disconnect returned false');
      onConnectionChange(false);
    } catch (error: unknown) {
      setStatusMsg('Error: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  return (
    <div className="px-6 py-6 max-w-2xl w-full mx-auto">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge
                        flex items-center justify-center shrink-0 mt-0.5">
          <Cpu className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-hi leading-tight">NFC Reader</h1>
          <p className="text-[14px] text-lo mt-0.5">Configure serial port connection to PN532</p>
        </div>
      </div>

      {/* Connection card */}
      <div className="bg-card border border-edge rounded-2xl p-5 mb-4">

        {/* Status row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <span className={`w-3 h-3 rounded-full transition-all duration-300
                              ${isConnected
                                ? 'bg-ok'
                                : 'bg-err opacity-70'}`} />
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
              onClick={fetchPorts}
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
              onChange={e => setPort(e.target.value)}
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

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleConnect}
            disabled={isConnected || !port}
            className="flex-1 py-3 rounded-xl text-[16px] font-medium text-white
                       bg-accent-solid hover:bg-accent-hover active:scale-[0.98]
                       disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                       disabled:cursor-not-allowed transition-all duration-150"
          >
            Connect
          </button>
          <button
            onClick={handleDisconnect}
            disabled={!isConnected}
            className="flex-1 py-3 rounded-xl text-[16px] font-medium text-err
                       bg-input border border-err-edge hover:bg-err-soft active:scale-[0.98]
                       disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                       disabled:cursor-not-allowed transition-all duration-150"
          >
            Disconnect
          </button>
        </div>

        {/* Status message */}
        {statusMsg && (
          <div className="mt-4 px-4 py-3 bg-input border border-edge rounded-xl
                          text-[15px] text-mid leading-relaxed">
            {statusMsg}
          </div>
        )}
      </div>

      {/* Output toggle — only shown when the panel is enabled in Settings */}
      {terminalEnabled && (
        <button
          onClick={onToggleTerminal}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[16px] border
                      select-none active:scale-[0.98] transition-all duration-150
                      ${isTerminalOpen
                        ? 'bg-accent-soft border-accent-edge text-accent'
                        : 'bg-card border-edge text-mid hover:text-hi hover:border-edge2'}`}
        >
          <Terminal className="w-5 h-5" />
          {isTerminalOpen ? 'Hide Output' : 'Show Output'}
        </button>
      )}
    </div>
  );
};
