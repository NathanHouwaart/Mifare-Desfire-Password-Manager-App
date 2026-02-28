import { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, Terminal } from 'lucide-react';
import { ConnectionCard }     from '../Components/Nfc/ConnectionCard';
import { FirmwareVersionCard } from '../Components/Nfc/FirmwareVersionCard';
import { CardVersionCard }    from '../Components/Nfc/CardVersionCard';
import { SelfTestCard, INITIAL_TESTS } from '../Components/Nfc/SelfTestCard';
import type { TestResult }     from '../Components/Nfc/SelfTestCard';

// Stable canonical ID map â€” avoids fragile string transforms on C++ names
const TEST_ID_BY_NAME: Record<string, string> = {
  'ROM Check':     'rom',
  'RAM Check':     'ram',
  'Communication': 'communication',
  'Echo Test':     'echo',
  'Antenna':       'antenna',
};

// Extract error.code from a native binding rejection
function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return 'HARDWARE_ERROR';
}

interface NfcReaderPageProps {
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  isConnected: boolean;
  onConnectionChange: (connected: boolean) => void;
  terminalEnabled: boolean;
  highlightConnect?: boolean;
}

export const NfcReaderPage = ({
  isTerminalOpen, onToggleTerminal,
  isConnected, onConnectionChange, terminalEnabled,
  highlightConnect = false,
}: NfcReaderPageProps) => {

  /* â”€â”€ Connection state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const [port,           setPort]           = useState('');
  const [statusMsg,      setStatusMsg]      = useState('');
  const [availablePorts, setAvailablePorts] = useState<ComPort[]>([]);
  const [portsLoading,   setPortsLoading]   = useState(false);

  /* â”€â”€ Firmware card state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const [firmware,        setFirmware]        = useState<string | null>(null);
  const [firmwareLoading, setFirmwareLoading] = useState(false);
  const [firmwareStale,   setFirmwareStale]   = useState(true);
  const [firmwareError,   setFirmwareError]   = useState<string | null>(null);

  /* â”€â”€ Self-test state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const [tests,        setTests]        = useState<TestResult[]>(INITIAL_TESTS);
  const [testRunning,  setTestRunning]  = useState(false);
  const [testSummary,  setTestSummary]  = useState<string | null>(null);
  const [testsStarted, setTestsStarted] = useState(false);

  /* â”€â”€ Card version state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const [cardVersion, setCardVersion] = useState<CardVersionInfoDto | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardStale,   setCardStale]   = useState(true);
  const [cardError,   setCardError]   = useState<string | null>(null);

  /* â”€â”€ Stale skeleton timers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  useEffect(() => {
    const fw = setTimeout(() => setFirmwareStale(false), 1800);
    const cv = setTimeout(() => setCardStale(false),     1400);
    return () => { clearTimeout(fw); clearTimeout(cv); };
  }, []);

  /* â”€â”€ Reset all cards on disconnect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  useEffect(() => {
    if (!isConnected) {
      setFirmware(null);
      setFirmwareLoading(false);
      setFirmwareError(null);
      setCardVersion(null);
      setCardLoading(false);
      setCardError(null);
      setTests(INITIAL_TESTS);
      setTestRunning(false);
      setTestSummary(null);
      setTestsStarted(false);
    }
  }, [isConnected]);

  // Only trigger auto-connect once on mount.
  const autoConnectDoneRef = useRef(false);

  /* â”€â”€ COM port helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  useEffect(() => {
    // On mount: fetch ports, then auto-connect if the setting is on.
    // Guard: skip entirely if the reader is already connected (e.g. after a
    // lock/unlock cycle that re-mounts this page without disconnecting).
    const run = async () => {
      await fetchPorts();
      if (autoConnectDoneRef.current) return;
      autoConnectDoneRef.current = true;
      if (isConnected) return;                          // already up — don't reconnect
      if ((localStorage.getItem('setting-autoconnect') ?? 'true') !== 'true') return;
      const lastPort = localStorage.getItem('setting-last-port');
      if (!lastPort) return;
      setStatusMsg('Auto-connecting to ' + lastPort + '…');
      await connectWithRetry(lastPort);
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Core connection attempt with per-attempt timeout and configurable retries. */
  const connectWithRetry = useCallback(async (targetPort: string) => {
    const timeoutSecs = parseInt(localStorage.getItem('setting-conn-timeout') ?? '10', 10);
    const maxRetries  = parseInt(localStorage.getItem('setting-retries')      ?? '3',  10);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const label = maxRetries > 0 ? ' (' + (attempt + 1) + '/' + (maxRetries + 1) + ')' : '';
      setStatusMsg('Connecting' + label + '…');
      try {
        const result = await Promise.race<string>([
          window.electron.connect(targetPort),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Connection timed out')), timeoutSecs * 1000)
          ),
        ]);
        localStorage.setItem('setting-last-port', targetPort);
        setStatusMsg(result);
        onConnectionChange(true);
        return;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt < maxRetries) {
          setStatusMsg('Failed: ' + msg + ' — retrying in 1 s… (' + (attempt + 1) + '/' + (maxRetries + 1) + ')');
          await new Promise(r => setTimeout(r, 1000));
        } else {
          setStatusMsg('Error: ' + msg);
          onConnectionChange(false);
        }
      }
    }
  }, [onConnectionChange]);

  const handleConnect = useCallback(async () => {
    if (!port) return;
    await connectWithRetry(port);
  }, [port, connectWithRetry]);

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
  /* â”€â”€ Real IPC handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const handleGetFirmware = async () => {
    setFirmwareLoading(true);
    setFirmware(null);
    setFirmwareError(null);
    try {
      const result = await window.electron.getFirmwareVersion();
      setFirmware(result);
    } catch (err: unknown) {
      const code = errorCode(err);
      const msg  = err instanceof Error ? err.message : String(err);
      setFirmwareError(
        code === 'NOT_CONNECTED' ? 'Connect to PN532 first.' : 'Error: ' + msg
      );
    } finally {
      setFirmwareLoading(false);
    }
  };

  const handleRunSelfTests = async () => {
    setTestRunning(true);
    setTestsStarted(true);
    setTestSummary(null);
    // First row starts spinning immediately; the rest stay pending until the row before them completes
    setTests(INITIAL_TESTS.map((t, i) => ({ ...t, status: i === 0 ? 'running' : 'pending' })));

    // Register the streaming listener before invoking so no events are missed
    const unsubscribe = window.electron.onSelfTestProgress((row) => {
      const id = TEST_ID_BY_NAME[row.name] ?? row.name.toLowerCase().replace(/\s/g, '_');
      setTests(prev => {
        const next = prev.map(t => t.id === id ? { ...t, status: row.status } : t);
        // Mark the immediately following pending row as 'running' so the spinner advances
        const justFinishedIdx = next.findIndex(t => t.id === id);
        if (justFinishedIdx !== -1 && justFinishedIdx + 1 < next.length) {
          const nextRow = next[justFinishedIdx + 1];
          if (nextRow.status === 'pending') {
            next[justFinishedIdx + 1] = { ...nextRow, status: 'running' };
          }
        }
        return next;
      });
    });

    try {
      const report = await window.electron.runSelfTests();
      // Final authoritative state from the full report (handles any missed events)
      setTests(report.results.map(r => ({
        id:     TEST_ID_BY_NAME[r.name] ?? r.name.toLowerCase().replace(/\s/g, '_'),
        label:  r.name,
        status: r.status,
      })));
      const passed = report.results.filter(r => r.status === 'success').length;
      setTestSummary(passed === 5 ? 'All 5 tests passed' : `${passed}/5 tests passed`);
    } catch (err: unknown) {
      const code = errorCode(err);
      const msg  = err instanceof Error ? err.message : String(err);
      setTests(INITIAL_TESTS.map(t => ({ ...t, status: 'failed' })));
      setTestSummary(code === 'NOT_CONNECTED' ? 'Connect to PN532 first.' : 'Error: ' + msg);
    } finally {
      unsubscribe();
      setTestRunning(false);
    }
  };

  const handleGetCardVersion = async () => {
    setCardLoading(true);
    setCardVersion(null);
    setCardError(null);
    try {
      const result = await window.electron.getCardVersion();
      setCardVersion(result);
    } catch (err: unknown) {
      const code = errorCode(err);
      setCardError(
        code === 'NO_CARD'        ? 'Tap a DESFire card and try again.'        :
        code === 'NOT_DESFIRE'    ? 'Card detected but not DESFire-compatible.' :
        code === 'NOT_CONNECTED'  ? 'Connect to PN532 first.'                  :
        'Error: ' + (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setCardLoading(false);
    }
  };

  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

        {/* Connection â€” full width */}
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
            highlightConnect={highlightConnect}
          />
        </div>

        {/* Firmware Version */}
        <FirmwareVersionCard
          isConnected={isConnected}
          firmware={firmware}
          loading={firmwareLoading}
          stale={firmwareStale}
          errorMsg={firmwareError}
          onGetFirmware={handleGetFirmware}
        />

        {/* Card Version */}
        <CardVersionCard
          isConnected={isConnected}
          cardVersion={cardVersion}
          loading={cardLoading}
          stale={cardStale}
          errorMsg={cardError}
          onGetVersion={handleGetCardVersion}
        />

        {/* Self-Test Diagnostics â€” full width */}
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
