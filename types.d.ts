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

/** Result of opening the bundled browser extension folder. */
type ExtensionOpenFolderResultDto = {
  ok:    boolean;
  path?: string;
  error?: string;
};

type SyncInvitePayloadDto = {
  baseUrl: string;
  username?: string;
};

type SyncConfigDto = {
  baseUrl: string;
  username: string;
  deviceName?: string;
};

type SyncUsernameCheckDto = {
  exists: boolean;
};

type SyncBootstrapDto = {
  password: string;
  bootstrapToken: string;
};

type SyncRegisterDto = {
  password: string;
};

type SyncLoginDto = {
  password: string;
  mfaCode?: string;
};

type SyncMfaCodeDto = {
  code: string;
};

type SyncMfaStatusDto = {
  mfaEnabled: boolean;
  pendingEnrollment: boolean;
};

type SyncMfaSetupDto = {
  issuer: string;
  accountName: string;
  secret: string;
  otpauthUrl: string;
};

type SyncVaultKeyPasswordDto = {
  password: string;
};

type SyncVaultKeyPassphraseDto = {
  passphrase: string;
};

type SyncStatusDto = {
  configured: boolean;
  loggedIn: boolean;
  baseUrl?: string;
  username?: string;
  deviceName?: string;
  cursor: number;
  lastSyncAt?: number;
  lastSyncAttemptAt?: number;
  lastSyncError?: string;
};

type SyncPushResultDto = {
  sent: number;
  applied: number;
  skipped: number;
  cursor: number;
};

type SyncPullResultDto = {
  received: number;
  applied: number;
  deleted: number;
  cursor: number;
  hasMore: boolean;
};

type SyncRunResultDto = {
  push: SyncPushResultDto;
  pull: SyncPullResultDto;
};

type SyncVaultKeyEnvelopeDto = {
  keyVersion: number;
  kdf: 'scrypt-v1';
  kdfParams: {
    N: number;
    r: number;
    p: number;
    dkLen: number;
  };
  salt: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
  updatedAt?: string;
};

type SyncVaultKeyStatusDto = {
  configured: boolean;
  loggedIn: boolean;
  hasRemoteEnvelope: boolean;
  hasLocalUnlockedKey: boolean;
  keyVersion?: number;
  unlockedAt?: number;
};

// ─────────────────────────────────────────────────────────────────────────────

type RendererEvents = {
  'nfc-log': NfcLogEntry;
  'nfc:selfTestProgress': SelfTestResultDto;
  'securepass:syncInvite': SyncInvitePayloadDto;
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
  /** Single-scan probe with vault compatibility check against the active root key. */
  'card:probe': () => Promise<{
    uid: string | null;
    isInitialised: boolean;
    isCompatibleWithCurrentVault: boolean | null;
    compatibilityError?: string;
  }>;
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

  // ── Browser extension helpers ────────────────────────────────────────
  /** Opens the bundled extension folder in the OS file manager. */
  'extension:open-folder': () => Promise<ExtensionOpenFolderResultDto>;
  /** Re-runs the native messaging host registration (rewrites bat + registry keys). */
  'extension:reload-registration': () => Promise<{ ok: boolean; error?: string }>;

  // —— Sync operations ——————————————————————————————————————————————————————————————
  /** Returns current local sync config/session status. */
  'sync:getStatus': () => Promise<SyncStatusDto>;
  /** Returns and clears a pending startup invite payload (if any). */
  'sync:consumeInvite': () => Promise<SyncInvitePayloadDto | null>;
  /** Persists sync endpoint + username/device metadata. */
  'sync:setConfig': (config: SyncConfigDto) => Promise<SyncStatusDto>;
  /** Checks whether the configured username already exists on the server. */
  'sync:checkUsername': () => Promise<SyncUsernameCheckDto>;
  /** Removes local sync config and session data. */
  'sync:clearConfig': () => Promise<SyncStatusDto>;
  /** Legacy one-time account bootstrap against a fresh server. */
  'sync:bootstrap': (payload: SyncBootstrapDto) => Promise<SyncStatusDto>;
  /** Register a new account on the sync server. */
  'sync:register': (payload: SyncRegisterDto) => Promise<SyncStatusDto>;
  /** Login to sync server and store encrypted refresh/access session. */
  'sync:login': (payload: SyncLoginDto) => Promise<SyncStatusDto>;
  /** Returns current MFA enrollment status for the authenticated account. */
  'sync:mfaStatus': () => Promise<SyncMfaStatusDto>;
  /** Starts MFA setup and returns secret + otpauth URL for authenticator apps. */
  'sync:mfaSetup': () => Promise<SyncMfaSetupDto>;
  /** Completes MFA setup by verifying a current authenticator code. */
  'sync:mfaEnable': (payload: SyncMfaCodeDto) => Promise<SyncMfaStatusDto>;
  /** Disables MFA after verifying a current authenticator code. */
  'sync:mfaDisable': (payload: SyncMfaCodeDto) => Promise<SyncMfaStatusDto>;
  /** Logout and clear local session state. */
  'sync:logout': () => Promise<SyncStatusDto>;
  /** Logs out, clears sync config, and wipes local vault data so another user can sign in safely. */
  'sync:switchUser': () => Promise<SyncStatusDto>;
  /** Pushes locally queued encrypted changes. */
  'sync:push': () => Promise<SyncPushResultDto>;
  /** Pulls remote encrypted changes since local cursor. */
  'sync:pull': () => Promise<SyncPullResultDto>;
  /** Convenience: push then pull in one call. */
  'sync:syncNow': () => Promise<SyncRunResultDto>;
  /** Fetches server-stored vault key envelope. */
  'sync:getVaultKeyEnvelope': () => Promise<SyncVaultKeyEnvelopeDto | null>;
  /** Returns local+remote vault key manager status. */
  'sync:getVaultKeyStatus': () => Promise<SyncVaultKeyStatusDto>;
  /** Initializes or unlocks the synced vault key using the account password. */
  'sync:prepareVaultKey': (payload: SyncVaultKeyPasswordDto) => Promise<SyncVaultKeyStatusDto>;
  /** Deprecated compatibility channel, routes to sync:prepareVaultKey. */
  'sync:initVaultKey': (payload: SyncVaultKeyPassphraseDto) => Promise<SyncVaultKeyStatusDto>;
  /** Deprecated compatibility channel, routes to sync:prepareVaultKey. */
  'sync:unlockVaultKey': (payload: SyncVaultKeyPassphraseDto) => Promise<SyncVaultKeyStatusDto>;
  /** Clears locally-unlocked vault root key from process memory. */
  'sync:lockVaultKey': () => Promise<SyncVaultKeyStatusDto>;
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
  onSyncInvite: (callback: (payload: SyncInvitePayloadDto) => void) => () => void;
};

// 4) augment global Window so you only maintain IPCHandlers
interface Window {
  electron: ExposedElectronAPI;
}
