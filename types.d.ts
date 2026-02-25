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

// ── Vault DTOs ────────────────────────────────────────────────────────────────

/** Metadata-only row returned by vault:listEntries — no decryption required. */
type EntryListItemDto = {
  id:        string;
  label:     string;
  url:       string;
  category:  string;
  createdAt: number;
  updatedAt: number;
};

/** Fully-decrypted entry returned by vault:getEntry. */
type EntryPayloadDto = EntryListItemDto & {
  username:    string;
  password:    string;
  totpSecret?: string;
  notes?:      string;
};

/** Params for vault:createEntry. */
type EntryCreateDto = {
  label:       string;
  url:         string;
  category?:   string;
  username:    string;
  password:    string;
  totpSecret?: string;
  notes?:      string;
};

/**
 * Params for vault:updateEntry.
 * All fields are required — the caller sends the complete desired state.
 * Omitted optional fields (totpSecret, notes) may be undefined to clear them.
 */
type EntryUpdateDto = {
  label:       string;
  url:         string;
  category?:   string;
  username:    string;
  password:    string;
  totpSecret?: string;
  notes?:      string;
};

/** Options for vault:listEntries. */
type VaultListOptsDto = {
  search?: string;
  limit?:  number;
  offset?: number;
};

/** Result of vault:export — returned to the renderer after the save dialog. */
type VaultExportResultDto = {
  success:  boolean;
  path?:    string;
  count?:   number;
  error?:   string;
};

/** Result of vault:import — returned to the renderer after processing a backup file. */
type VaultImportResultDto = {
  success:   boolean;
  imported?: number;
  skipped?:  number;
  error?:    string;
};

// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Card operations ────────────────────────────────────────────────────────
  /** Lightweight presence probe. Resolves null when no card is present. */
  'card:peekUid': () => Promise<string | null>;
  /** True if the vault application (AID 505700) exists on the card. */
  'card:isInitialised': () => Promise<boolean>;
  /** Single-scan combined probe: one RF scan returning uid + isInitialised. */
  'card:probe': () => Promise<{ uid: string | null; isInitialised: boolean }>;
  /** Waits for card tap then runs the full secure initialisation sequence. */
  'card:init': () => Promise<boolean>;
  /** Free EEPROM bytes remaining on the PICC. */
  'card:freeMemory': () => Promise<number>;
  /** FormatPICC — destroys all card data AND wipes the local vault DB. */
  'card:format': () => Promise<boolean>;
  /** Returns AIDs present on the card as uppercase hex strings, e.g. ["505700"]. */
  'card:getAids': () => Promise<string[]>;
  /** Aborts any in-progress card-wait polling loop immediately. */
  'nfc:cancel': () => Promise<void>;
  /** Clears the system clipboard from the main process — no document-focus restriction. */
  'clipboard:clear': () => Promise<void>;
  /** Reads the current system clipboard text from the main process — no document-focus restriction. */
  'clipboard:read':  () => Promise<string>;

  // ── Vault operations (card-gated where noted) ─────────────────────────────
  /** Returns metadata rows only — no card tap needed. */
  'vault:listEntries': (opts?: VaultListOptsDto) => Promise<EntryListItemDto[]>;
  /** Taps card, decrypts and returns the full entry payload. */
  'vault:getEntry': (id: string) => Promise<EntryPayloadDto>;
  /** Taps card, encrypts and inserts a new entry; returns the metadata row. */
  'vault:createEntry': (params: EntryCreateDto) => Promise<EntryListItemDto>;
  /** Taps card, re-encrypts and overwrites an entry; returns updated metadata. */
  'vault:updateEntry': (id: string, params: EntryUpdateDto) => Promise<EntryListItemDto>;
  /** Deletes an entry — no card tap needed. Returns true if a row was deleted. */
  'vault:deleteEntry': (id: string) => Promise<boolean>;
  /** Exports all encrypted entries to a user-chosen JSON file. No card needed. */
  'vault:export': () => Promise<VaultExportResultDto>;
  /** Imports entries from a JSON backup file, merging with existing vault. No card needed. */
  'vault:import': () => Promise<VaultImportResultDto>;
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
