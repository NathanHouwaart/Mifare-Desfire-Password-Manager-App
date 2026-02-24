type NfcLogEntry = { level: 'info' | 'warn' | 'error'; message: string; timestamp: string };
type ComPort = { path: string; manufacturer?: string };

type SelfTestStatus    = 'success' | 'failed' | 'skipped';
type SelfTestResultDto = { name: string; status: SelfTestStatus; detail: string };
type SelfTestReportDto = {
  // Tuple enforces the 5-row contract at compile time — mirrors std::array<SelfTestResult,5>
  results: [SelfTestResultDto, SelfTestResultDto, SelfTestResultDto,
            SelfTestResultDto, SelfTestResultDto];
};
type CardVersionInfoDto = {
  hwVersion:     string;
  swVersion:     string;
  uidHex:        string;
  storage:       string;
  rawVersionHex: string;
};

type RendererEvents = {
  'nfc-log': NfcLogEntry;
  'nfc:selfTestProgress': SelfTestResultDto;
};

// 1) canonical single source: define your IPC handlers here
type IPCHandlers = {
  greet: (name: string) => Promise<string>;
  add: (a: number, b: number) => Promise<number>;
  connect: (port: string) => Promise<string>;
  disconnect: () => Promise<boolean>;
  listComPorts: () => Promise<ComPort[]>;
  saveFile: (filename: string, content: string) => Promise<boolean>;
  getFirmwareVersion: () => Promise<string>;
  runSelfTests: () => Promise<SelfTestReportDto>;
  getCardVersion: () => Promise<CardVersionInfoDto>;
};

// 2) helpers derived from IPCHandlers
type EventInvokeArgs = { [K in keyof IPCHandlers]: Parameters<IPCHandlers[K]> };
type EventPayloadMapping = { [K in keyof IPCHandlers]: Awaited<ReturnType<IPCHandlers[K]>> } & RendererEvents;

// 3) derive the exact shape to expose on window.electron
type ExposedElectronAPI = {
  [K in keyof IPCHandlers]: (...args: EventInvokeArgs[K]) => ReturnType<IPCHandlers[K]>;
} & {
  onNfcLog: (callback: (entry: NfcLogEntry) => void) => () => void;
  onSelfTestProgress: (callback: (result: SelfTestResultDto) => void) => () => void;
};

// 4) augment global Window so you only maintain IPCHandlers
interface Window {
  electron: ExposedElectronAPI;
}
