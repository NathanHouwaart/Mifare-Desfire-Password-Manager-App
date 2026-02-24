import {
  Activity, Loader2, Circle,
  CheckCircle2, XCircle, AlertCircle, MinusCircle,
} from 'lucide-react';

export type TestStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface TestResult {
  id:     string;
  label:  string;
  status: TestStatus;
}

export const INITIAL_TESTS: TestResult[] = [
  { id: 'rom',           label: 'ROM Check',     status: 'pending' },
  { id: 'ram',           label: 'RAM Check',     status: 'pending' },
  { id: 'communication', label: 'Communication', status: 'pending' },
  { id: 'echo',          label: 'Echo Test',     status: 'pending' },
  { id: 'antenna',       label: 'Antenna',       status: 'pending' },
];

interface SelfTestCardProps {
  isConnected:  boolean;
  tests:        TestResult[];
  testRunning:  boolean;
  testSummary:  string | null;
  testsStarted: boolean;
  onRunTests:   () => void;
}

const testIcon = (status: TestStatus) => {
  switch (status) {
    case 'pending': return <Circle       className="w-4 h-4 text-dim animate-pulse" />;
    case 'running': return <Loader2      className="w-4 h-4 text-accent animate-spin" />;
    case 'success': return <CheckCircle2 className="w-4 h-4 text-ok" />;
    case 'failed':  return <XCircle      className="w-4 h-4 text-err" />;
    case 'skipped': return <MinusCircle  className="w-4 h-4 text-mid" />;
  }
};

const testRowCls = (status: TestStatus) => {
  switch (status) {
    case 'pending': return 'bg-well border-edge';
    case 'running': return 'bg-accent-soft border-accent-edge';
    case 'success': return 'bg-ok-soft border-ok-edge';
    case 'failed':  return 'bg-err-soft border-err-edge';
    case 'skipped': return 'bg-well border-edge';
  }
};

const testLabelCls = (status: TestStatus) => {
  switch (status) {
    case 'pending': return 'text-dim';
    case 'running': return 'text-accent';
    case 'success': return 'text-ok';
    case 'failed':  return 'text-err';
    case 'skipped': return 'text-mid';
  }
};

export const SelfTestCard = ({
  isConnected, tests, testRunning, testSummary, testsStarted, onRunTests,
}: SelfTestCardProps) => {
  const allPassed = tests.every(t => t.status === 'success');
  const anyFailed = tests.some(t  => t.status === 'failed');

  return (
    <div className="bg-card border border-edge rounded-2xl p-5">

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
          onClick={onRunTests}
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
  );
};
