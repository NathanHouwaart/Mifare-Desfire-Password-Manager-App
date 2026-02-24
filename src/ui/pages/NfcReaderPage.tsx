import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Terminal, ChevronDown, RefreshCw,
  Download, Activity, Zap, Circle, Loader2,
  CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';

type TestStatus = 'pending' | 'running' | 'success' | 'failed';

interface TestResult {
  id: string;
  label: string;
  status: TestStatus;
}

const INITIAL_TESTS: TestResult[] = [
  { id: 'rom',           label: 'ROM Check',      status: 'pending' },
  { id: 'ram',           label: 'RAM Check',      status: 'pending' },
  { id: 'communication', label: 'Communication',  status: 'pending' },
  { id: 'echo',          label: 'Echo Test',      status: 'pending' },
  { id: 'antenna',       label: 'Antenna',        status: 'pending' },
];

interface NfcReaderPageProps {
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  isConnected: boolean;
  onConnectionChange: (connected: boolean) => void;
  terminalEnabled: boolean;
}

export const NfcReaderPage = ({
  isTerminalOpen, onToggleTerminal,
  isConnected, onConnectionChange, terminalEnabled,
}: NfcReaderPageProps) => {
  // Connection state
  const [port,           setPort]           = useState('');
  const [statusMsg,      setStatusMsg]      = useState('');
  const [availablePorts, setAvailablePorts] = useState<ComPort[]>([]);
  const [portsLoading,   setPortsLoading]   = useState(false);

  // Firmware card state
  const [firmware,        setFirmware]        = useState<string | null>(null);
  const [firmwareLoading, setFirmwareLoading] = useState(false);
  const [firmwareStale,   setFirmwareStale]   = useState(true);   // stale skeleton on mount

  // Self-test state
  const [tests,        setTests]        = useState<TestResult[]>(INITIAL_TESTS);
  const [testRunning,  setTestRunning]  = useState(false);
  const [testSummary,  setTestSummary]  = useState<string | null>(null);
  const [testsStarted, setTestsStarted] = useState(false);

  // Debug version state
  const [debugVersion,  setDebugVersion]  = useState<string | null>(null);
  const [debugLoading,  setDebugLoading]  = useState(false);
  const [debugStale,    setDebugStale]    = useState(true);       // stale skeleton on mount

  // Dismiss stale skeletons after a short delay so the shimmer is visible on load
  useEffect(() => {
    const fw = setTimeout(() => setFirmwareStale(false), 1800);
    const dv = setTimeout(() => setDebugStale(false),    1400);
    return () => { clearTimeout(fw); clearTimeout(dv); };
  }, []);

  // Reset all card state when the reader is disconnected
  useEffect(() => {
    if (!isConnected) {
      setFirmware(null);
      setFirmwareLoading(false);
      setDebugVersion(null);
      setDebugLoading(false);
      setTests(INITIAL_TESTS);
      setTestRunning(false);
      setTestSummary(null);
      setTestsStarted(false);
    }
  }, [isConnected]);

  /* ── COM Port helpers ─────────────────────────────────────────── */
  const fetchPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      const ports = await window.electron.listComPorts();
      setAvailablePorts(ports);
      setPort(prev => {
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

  /* ── Stub handlers — real IPC wired up in a later pass ────────── */
  const handleGetFirmware = async () => {
    setFirmwareLoading(true);
    setFirmware(null);
    // TODO: replace with window.electron.getFirmwareVersion()
    await new Promise(r => setTimeout(r, 1400));
    setFirmware('PN532 v1.6  (chip: 0x0106)');
    setFirmwareLoading(false);
  };

  const handleRunSelfTests = async () => {
    setTestRunning(true);
    setTestsStarted(true);
    setTestSummary(null);
    setTests(INITIAL_TESTS.map(t => ({ ...t, status: 'pending' })));
    // TODO: replace with window.electron.runSelfTests()
    for (let i = 0; i < INITIAL_TESTS.length; i++) {
      setTests(prev => prev.map((t, idx) =>
        idx === i ? { ...t, status: 'running' } : t,
      ));
      await new Promise(r => setTimeout(r, 650));
      setTests(prev => prev.map((t, idx) =>
        idx === i ? { ...t, status: 'success' } : t,
      ));
    }
    setTestSummary('All 5 tests passed');
    setTestRunning(false);
  };

  const handleGetDebugVersion = async () => {
    setDebugLoading(true);
    setDebugVersion(null);
    // TODO: replace with window.electron.getVersion()
    await new Promise(r => setTimeout(r, 1100));
    setDebugVersion('SecurePass v0.1.0-dev  —  build 2024.12.01');
    setDebugLoading(false);
  };

  /* ── Test row helpers ─────────────────────────────────────────── */
  const testIcon = (status: TestStatus) => {
    switch (status) {
      case 'pending': return <Circle       className="w-4 h-4 text-dim animate-pulse" />;
      case 'running': return <Loader2      className="w-4 h-4 text-accent animate-spin" />;
      case 'success': return <CheckCircle2 className="w-4 h-4 text-ok" />;
      case 'failed':  return <XCircle      className="w-4 h-4 text-err" />;
    }
  };

  const testRowCls = (status: TestStatus) => {
    switch (status) {
      case 'pending': return 'bg-well border-edge';
      case 'running': return 'bg-accent-soft border-accent-edge';
      case 'success': return 'bg-ok-soft border-ok-edge';
      case 'failed':  return 'bg-err-soft border-err-edge';
    }
  };

  const testLabelCls = (status: TestStatus) => {
    switch (status) {
      case 'pending': return 'text-dim';
      case 'running': return 'text-accent';
      case 'success': return 'text-ok';
      case 'failed':  return 'text-err';
    }
  };

  const allPassed = tests.every(t => t.status === 'success');
  const anyFailed = tests.some(t  => t.status === 'failed');

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="px-6 py-6 max-w-4xl w-full mx-auto">

      {/* Page header */}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Connection card (full width) ─────────────────────── */}
        <div className="lg:col-span-2 bg-card border border-edge rounded-2xl p-5">

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

          {/* Connect / Disconnect buttons */}
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

        {/* ── Firmware Version card ────────────────────────────── */}
        <div className="bg-card border border-edge rounded-2xl p-5 flex flex-col">
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
            {firmwareLoading || firmwareStale ? (
              <div className="w-full space-y-2">
                <div className="h-3 bg-input rounded-lg animate-pulse w-3/4" />
                <div className="h-3 bg-input rounded-lg animate-pulse w-5/12" />
              </div>
            ) : firmware ? (
              <span className="font-mono text-[14px] text-bright leading-relaxed">{firmware}</span>
            ) : (
              <span className="text-[14px] text-dim italic">Connect and query to read firmware</span>
            )}
          </div>

          <button
            onClick={handleGetFirmware}
            disabled={!isConnected || firmwareLoading}
            className="w-full py-2.5 rounded-xl text-[15px] font-medium text-white
                       bg-accent-solid hover:bg-accent-hover active:scale-[0.98]
                       disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                       disabled:cursor-not-allowed transition-all duration-150"
          >
            {firmwareLoading ? 'Reading…' : 'Get Firmware Version'}
          </button>
        </div>

        {/* ── Debug Version card ───────────────────────────────── */}
        <div className="bg-card border border-edge rounded-2xl p-5 flex flex-col">
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
            {debugLoading || debugStale ? (
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
            onClick={handleGetDebugVersion}
            disabled={!isConnected || debugLoading}
            className="w-full py-2.5 rounded-xl text-[15px] font-medium text-warn
                       bg-warn-soft border border-warn-edge hover:opacity-80 active:scale-[0.98]
                       disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                       disabled:cursor-not-allowed transition-all duration-150"
          >
            {debugLoading ? 'Reading…' : 'Get Debug Version'}
          </button>
        </div>

        {/* ── Self-Test Diagnostics card (full width) ──────────── */}
        <div className="lg:col-span-2 bg-card border border-edge rounded-2xl p-5">

          {/* Card header + Run button */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-ok-soft border border-ok-edge
                              flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4 text-ok" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-hi">Self-Test Diagnostics</p>
                <p className="text-[13px] text-lo mt-0.5">Run hardware checks on the PN532</p>
              </div>
            </div>
            <button
              onClick={handleRunSelfTests}
              disabled={!isConnected || testRunning}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-medium
                         text-ok bg-ok-soft border border-ok-edge
                         hover:opacity-80 active:scale-[0.98]
                         disabled:bg-input disabled:text-dim disabled:border disabled:border-edge
                         disabled:cursor-not-allowed transition-all duration-150"
            >
              {testRunning
                ? <><Loader2  className="w-4 h-4 animate-spin" /> Running…</>
                : <><Activity className="w-4 h-4"              /> Run Tests</>}
            </button>
          </div>

          {/* Prompt — shown before the first run */}
          {!testsStarted && (
            <div className="px-4 py-3 bg-well border border-edge rounded-xl
                            text-[14px] text-dim italic">
              Press "Run All Tests" to display the individual self-test tiles and begin diagnostics.
            </div>
          )}

          {/* Test rows — only visible once a run has started */}
          {testsStarted && (
            <>
              <div className="space-y-2 mb-4">
                {tests.map(test => (
                  <div
                    key={test.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border
                                transition-all duration-300 ${testRowCls(test.status)}`}
                  >
                    <div className="flex items-center gap-3">
                      {testIcon(test.status)}
                      <span className={`text-[14px] font-medium transition-colors duration-200
                                        ${testLabelCls(test.status)}`}>
                        {test.label}
                      </span>
                    </div>
                    <span className={`text-[12px] font-semibold uppercase tracking-widest
                                      ${testLabelCls(test.status)}`}>
                      {test.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Summary bar — shown after a run completes */}
              {testSummary && (
                <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border
                                 text-[14px] font-medium transition-all duration-300
                                 ${allPassed
                                   ? 'bg-ok-soft border-ok-edge text-ok'
                                   : anyFailed
                                     ? 'bg-err-soft border-err-edge text-err'
                                     : 'bg-warn-soft border-warn-edge text-warn'}`}>
                  {allPassed
                    ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                    : anyFailed
                      ? <XCircle     className="w-4 h-4 shrink-0" />
                      : <AlertCircle className="w-4 h-4 shrink-0" />}
                  {testSummary}
                </div>
              )}
            </>
          )}
        </div>

      </div>{/* end grid */}

      {/* Output toggle — only shown when the panel is enabled in Settings */}
      {terminalEnabled && (
        <div className="mt-5">
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
        </div>
      )}
    </div>
  );
};
