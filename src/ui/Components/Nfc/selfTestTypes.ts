export type TestStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface TestResult {
  id: string;
  label: string;
  status: TestStatus;
}

export const INITIAL_TESTS: TestResult[] = [
  { id: 'rom', label: 'ROM Check', status: 'pending' },
  { id: 'ram', label: 'RAM Check', status: 'pending' },
  { id: 'communication', label: 'Communication', status: 'pending' },
  { id: 'echo', label: 'Echo Test', status: 'pending' },
  { id: 'antenna', label: 'Antenna', status: 'pending' },
];
