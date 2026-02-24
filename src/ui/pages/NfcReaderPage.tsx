import { useState, useEffect, useCallback } from 'react';
import { Cpu, Terminal } from 'lucide-react';
import { ConnectionCard }     from '../Components/Nfc/ConnectionCard';
import { FirmwareVersionCard } from '../Components/Nfc/FirmwareVersionCard';
import { DebugVersionCard }    from '../Components/Nfc/DebugVersionCard';
import { SelfTestCard, INITIAL_TESTS } from '../Components/Nfc/SelfTestCard';
import type { TestResult }     from '../Components/Nfc/SelfTestCard';

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

  /* ── Connection state ─────────────────────────────────────────── */
  const [port,           setPort]           = useState('');
  const [statusMsg,      setStatusMsg]      = useState('');
  const [availablePorts, setAvailablePorts] = useState<ComPort[]>([]);
  const [portsLoading,   setPortsLoading]   = useState(false);

  /* ── Firmware card state ──────────────────────────────────────── */
  const [firmware,        setFirmware]        = useState<string | null>(null);
  const [firmwareLoading, setFirmwareLoading] = useState(false);
  const [firmwareStale,   setFirmwareStale]   = useState(true);

  /* ── Self-test state ──────────────────────────────────────────── */
  const [tests,        setTests]        = useState<TestResult[]>(INITIAL_TESTS);
  const [testRunning,  setTestRunning]  = useState(false);
  const [testSummary,  setTestSummary]  = useState<string | null>(null);
  const [testsStarted, setTestsStarted] = useState(false);

  /* ── Debug version state ──────────────────────────────────────── */
  const [debugVersion, setDebugVersion] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugStale,   setDebugStale]   = useState(true);

  /* ── Stale skeleton timers ────────────────────────────────────── */
  useEffect(() => {
    const fw = setTimeout(() => setFirmwareStale(false), 1800);
    const dv = setTimeout(() => setDebugStale(false),    1400);
    return () => { clearTimeout(fw); clearTimeout(dv); };
  }, []);

  /* ── Reset all cards on disconnect ───────────────────────────── */
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

  /* ── COM port helpers ─────────────────────────────────────────── */
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

  /* ── Stub handlers (real IPC wired up in a later pass) ────────── */
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

        {/* Connection — full width */}
        <div className="lg:col-span-2">
          <ConnectionCard
            isConnected={isConnected}
            port={port}
            onPortChange={setPort}
            availablePorts={availablePorts}
            portsLoading={portsLoading}
            onFetchPorts={fetchPorts}
            statusMsg={statusMsg}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        </div>

        {/* Firmware Version */}
        <FirmwareVersionCard
          isConnected={isConnected}
          firmware={firmware}
          loading={firmwareLoading}
          stale={firmwareStale}
          onGetFirmware={handleGetFirmware}
        />

        {/* Debug Version */}
        <DebugVersionCard
          isConnected={isConnected}
          debugVersion={debugVersion}
          loading={debugLoading}
          stale={debugStale}
          onGetVersion={handleGetDebugVersion}
        />

        {/* Self-Test Diagnostics — full width */}
        <div className="lg:col-span-2">
          <SelfTestCard
            isConnected={isConnected}
            tests={tests}
            testRunning={testRunning}
            testSummary={testSummary}
            testsStarted={testsStarted}
            onRunTests={handleRunSelfTests}
          />
        </div>

      </div>

      {/* Output toggle */}
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
