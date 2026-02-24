# Password Storage - Option B (Card as Decryption Key)

Status: Planning (implementation-ready)  
Branch: `feature/password-storage`  
Architecture: Clean Architecture (Ports and Adapters)

---

## 1. Decision Summary

Use DESFire card material as one key factor and a machine-bound secret as the second key factor.

- Card stores only a small secret (`card_secret`) plus card metadata.
- SQLite on disk stores encrypted vault payloads.
- Decryption requires both:
  - physical card (`card_secret`)
  - machine secret from OS secure storage (`machineSecret`)

This keeps capacity practical (disk-backed) while preserving strong two-factor decryption.

---

## 2. Security Model

### 2.1 Threat assumptions

- DB stolen only: no plaintext (AES-256-GCM ciphertexts).
- Card stolen only: no plaintext (machine secret missing).
- Machine stolen only: no plaintext (card missing).
- Tampered ciphertext: GCM auth verification fails.

### 2.2 Explicit policy

- Secrets never cross into renderer process.
- `cardSecret` exists only in main-process memory while unlocked.
- `cardSecret` buffer is explicitly zeroized on lock/shutdown.
- If `safeStorage.isEncryptionAvailable() === false`, app is fail-closed:
  - no card init
  - no unlock
  - no vault decrypt/encrypt operations
- No secret values in logs, debug terminal, or thrown error text.

---

## 3. Data Layout

### 3.1 DESFire layout

App AID: `50:57:00`  
File 00: Backup Data File, 32 bytes, encrypted communication.

```
Bytes  0-15: card_secret (16 random bytes)
Bytes 16-31: reserved (0x00)
```

Notes:

- No UID echo is stored. Deriving the read key from the live UID and authenticating successfully proves the UID implicitly — an explicit echo check is redundant.
- UID is variable-length (4/7/10 bytes). Fixed 7-byte assumptions are forbidden.
- UID randomization must be disabled at init time (see Section 7.3).

### 3.2 SQLite layout (`vault.db`)

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id          TEXT PRIMARY KEY,      -- UUID v4
  label       TEXT NOT NULL,         -- plaintext (v1 decision)
  url         TEXT NOT NULL DEFAULT '', -- plaintext (v1 decision)
  created_at  INTEGER NOT NULL,      -- Unix ms
  updated_at  INTEGER NOT NULL,      -- Unix ms
  ciphertext  BLOB NOT NULL,
  iv          BLOB NOT NULL,         -- 12 bytes
  auth_tag    BLOB NOT NULL          -- 16 bytes
);

CREATE INDEX IF NOT EXISTS idx_entries_label
ON entries(label COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_entries_updated
ON entries(updated_at DESC);
```

Migration rule (v1):

1. If DB is empty, create schema and insert `schema_version(version=1)`.
2. On open, read schema version exactly once and run incremental migrations (`n -> n+1`) in a transaction.
3. Unknown/future schema version must fail startup with clear error (no partial behavior).

Encrypted payload JSON:

```ts
interface EntryPayload {
  username: string;
  password: string;
  totpSecret?: string;
  notes?: string;
}
```

Metadata privacy decision for v1:

- `label` and `url` remain plaintext for list UX and fast search.
- If cloud sync becomes default, add a metadata-encryption migration in v2.

---

## 4. Key Derivation and Crypto

All cryptography runs in main process only (`src/electron/keyDerivation.ts`).

### 4.1 Machine secret

- Generated once: 32 random bytes.
- Stored via `electron.safeStorage`.
- Persisted as encrypted blob at `<userData>/machine.secret`.

### 4.2 Card keys for DESFire operations

```ts
function deriveCardKey(
  machineSecret: Buffer,
  uid: Buffer,             // 4, 7, or 10 bytes
  role: 0x00 | 0x01 | 0x02 // 0x00 PICC (reserved), 0x01 app master, 0x02 app read
): Buffer {                // 16-byte AES key
  // Empty HKDF salt is intentional here because UID is already mixed into IKM.
  // Keep this behavior explicit and stable across versions.
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.concat([machineSecret, uid]),
    Buffer.alloc(0),
    Buffer.from([0x50, 0x57, 0x4b, role]),
    16
  ));
}
```

### 4.3 Per-entry key

```ts
function deriveEntryKey(
  cardSecret: Buffer,      // 16 B
  machineSecret: Buffer,   // 32 B
  entryId: string          // UUID v4
): Buffer {                // 32 B
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.concat([cardSecret, machineSecret]),
    Buffer.from(entryId, 'utf8'),
    Buffer.from('pwmgr-entry-v1'),
    32
  ));
}
```

### 4.4 Encryption primitive

- AES-256-GCM
- Fresh random 12-byte IV per write
- 16-byte auth tag persisted and always verified on decrypt

---

## 5. Per-Access Card Model

There is no persistent session. `card_secret` is never held in memory beyond the duration of a single cryptographic operation.

### 5.1 Access model

Every vault operation that requires decryption or encryption (view, copy, create, edit) triggers an on-demand card probe:

1. Renderer shows "Tap your card" overlay and calls the relevant vault IPC handler.
2. Main process emits `vault:awaitingCard` and starts a short-lived probe loop (`peekCardUid` at 300 ms intervals, 15 s timeout).
3. Card detected → main emits `vault:cardDetected` → reads `card_secret` → derives per-entry key → decrypts or encrypts → **zeroizes `card_secret` buffer immediately**.
4. Decrypted fields (or confirmation) returned to renderer. Renderer dismisses overlay.
5. If the user cancels, renderer calls `vault:cancelCardWait`. Main aborts the probe loop and rejects the handler promise.

`card_secret` lifetime is the duration of the HKDF + AES-GCM call — on the order of microseconds.

### 5.2 Probe loop rules

- Probe loop runs only during an active vault operation. No background polling exists.
- If an NFC operation (init/format/self-test) is already running when a vault operation starts, the handler rejects immediately with `READER_BUSY`.
- `peekCardUid` returns `NfcError{ "NO_CARD" }` when no card is present. The binding resolves this as `null` on the JS side. Any other error is rethrown to the probe loop.
- Probe loop is aborted immediately on `vault:cancelCardWait` or 15 s elapsed.

### 5.3 List view (no card needed)

`vault:listEntries` reads only `id`, `label`, `url`, `created_at`, `updated_at` — all plaintext columns. No card access required. The list renders while the card is in the user's pocket.

---

## 6. IPC Contract

Single source: `types.d.ts`.

### 6.1 Invoke handlers

```ts
// Card management
'card:freeMemory':        () => Promise<number>;
'card:getApplicationIds': () => Promise<string[]>;
'card:isInitialised':     () => Promise<boolean>;
'card:init':              () => Promise<void>;
'card:format':            () => Promise<void>;   // also wipes vault.db

// Vault — list (no card required)
'vault:listEntries':      (opts?: { offset?: number; limit?: number; query?: string })
                           => Promise<EntryListItemDto[]>;

// Vault — secret operations (each starts a card probe internally, up to 15 s)
'vault:getEntry':         (id: string) => Promise<EntryDto>;
'vault:createEntry':      (data: EntryFormDto) => Promise<EntryListItemDto>;
'vault:updateEntry':      (id: string, data: EntryFormDto) => Promise<EntryListItemDto>;
'vault:deleteEntry':      (id: string) => Promise<void>;  // no card needed

// Cancellation
'vault:cancelCardWait':   () => Promise<void>;  // aborts active probe loop
```

Notes:

- `vault:deleteEntry` requires no card — deleting the row makes the derived key permanently unusable.
- `query` in `vault:listEntries` searches `label` and `url` columns (LIKE, both plaintext).
- Pagination defaults: `offset = 0`, `limit = 200`.

### 6.2 Push events

```ts
'vault:awaitingCard':  {};  // main started probe loop; renderer shows overlay
'vault:cardDetected':  {};  // card found, decryption in progress; overlay shows spinner
```

Notes:

- No `session:changed`, `card:present`, or `card:removed` events. Card presence is scoped to active vault operations only.
- `CardPage.tsx` calls `card:isInitialised`, `card:freeMemory`, etc. directly and handles `NO_CARD` errors itself.

---

## 7. C++ Native Changes

### 7.1 Port changes (`INfcReader.h`)

```cpp
struct CardInitOptions {
  std::array<uint8_t, 3>  aid;           // {0x50, 0x57, 0x00}
  std::array<uint8_t, 16> appMasterKey;
  std::array<uint8_t, 16> readKey;
  std::array<uint8_t, 16> cardSecret;
};

virtual Result<bool> isCardInitialised() = 0;
virtual Result<bool> initCard(const CardInitOptions& opts) = 0;
virtual Result<std::vector<uint8_t>> readCardSecret(
  const std::array<uint8_t, 16>& readKey
) = 0;
virtual Result<uint32_t> cardFreeMemory() = 0;
virtual Result<bool> formatCard() = 0;
virtual Result<std::vector<std::array<uint8_t, 3>>> getCardApplicationIds() = 0;
virtual Result<std::vector<uint8_t>> peekCardUid() = 0; // NfcError{"NO_CARD"} when no card; binding resolves as null
```

Important:

- Do not use `Result<void>` with current `variant` result shape.

### 7.2 `NfcError` shape

Use consistent two-field error shape across all old and new methods:

```cpp
struct NfcError {
  std::string code;
  std::string message;
};
```

All single-field initializers are removed.

### 7.3 `initCard` secure sequence (`Pn532Adapter.cc`)

Required order:

1. Select PICC, authenticate PICC default key.
2. Call `setConfigurationPicc(...)` to disable random UID.
3. Create app `50:57:00`.
4. Select app.
5. Authenticate app default key.
6. Create File 00 (backup file, encrypted comm).
7. Change key 1 to `opts.readKey`.
8. Change key 0 to `opts.appMasterKey`.
9. Re-authenticate explicitly with `keyNo=0, key=opts.appMasterKey`.
10. Write File 00 payload (bytes 0–15: `opts.cardSecret`, bytes 16–31: `0x00` reserved).
11. Commit transaction.

This ensures sensitive write occurs only after secure keys are active.

### 7.4 PICC master key decision (explicit)

V1 decision:

- Keep PICC master key at default for recoverability and simpler formatting.
- Security tradeoff is accepted and documented: attacker could create/delete applications at PICC level.

Future hardening option:

- Rotate PICC key as well and require derived PICC key for format/admin operations.

### 7.5 `formatCard` consistency

- Because PICC key remains default in v1, `formatCard` uses current default-key behavior.
- If PICC rotation is enabled later, `formatCard` must authenticate with derived PICC key first.

### 7.6 Binding workers (`NfcCppBinding.cc`)

Add workers for:

- `isCardInitialised`
- `initCard`
- `readCardSecret`
- `cardFreeMemory`
- `formatCard`
- `getCardApplicationIds`
- `peekCardUid`

Error mapping:

- Reject with machine-readable error code and safe message (no secrets).

---

## 8. Electron Main Process Modules

Create:

- `src/electron/keyDerivation.ts`
- `src/electron/vault.ts`
- `src/electron/cardHandlers.ts`
- `src/electron/vaultHandlers.ts`

Modify:

- `src/electron/main.ts` (register handlers, secure storage init)
- `src/electron/preload.cts` (new invoke methods + push event listeners)
- `types.d.ts` (IPC and DTO contracts)

Not needed:

- `session.ts` — no persistent session state exists.
- `cardPresence.ts` — probe loops are scoped inside vault operation IPC handlers.

---

## 9. UI Changes

Add:

- `CardPage.tsx` for card management (init, format, memory, app IDs).
- Vault components for list/detail/form and locked overlay.

Update:

- `App.tsx`: no session subscription needed; existing lock screen and unlock remain as-is (separate concern from vault).
- `PasswordsPage.tsx`: replace in-memory mock with `vault:listEntries`; copy/view actions show "Tap card" overlay and call `vault:getEntry`.
- `Sidebar.tsx`: add Card route.

New UI component:

- `TapCardOverlay.tsx` — reusable overlay that shows "Tap your card" message, a spinner on `vault:cardDetected`, and a Cancel button wired to `vault:cancelCardWait`.

Renderer rules:

- Renderer never receives `cardSecret` or `machineSecret`.
- Renderer receives decrypted entry fields only after main-process vault handler completes.

---

## 10. Dependencies and Build

Dependencies:

- `better-sqlite3`
- `@types/better-sqlite3`

Build:

- Rebuild `better-sqlite3` against Electron ABI (postinstall or CI hook).

---

## 11. Performance Guardrails

`better-sqlite3` is synchronous in main process:

- Use pagination for lists.
- Keep indexes aligned with sort/filter fields.
- Avoid full-table scans per keystroke.
- Move heavy tasks (import/export/rekey) to worker-thread jobs or chunked pipeline.

Targets:

- Common `vault:listEntries` call < 20 ms for first page.
- UI keystroke search remains responsive under large datasets.

---

## 12. Implementation Phases

### Phase 1 — Foundation

1. Add `better-sqlite3` and `@types/better-sqlite3`; configure Electron ABI rebuild in `postinstall`.
2. Implement `keyDerivation.ts` — `deriveCardKey`, `deriveEntryKey`, `encryptEntry`, `decryptEntry`.
3. Implement `vault.ts` — open DB, run migrations (schema v1), export CRUD helpers.
4. Generate and persist `machineSecret` via `safeStorage` in `app.ready` handler.
5. Fail-closed guard: check `safeStorage.isEncryptionAvailable()` on startup.
6. **Verify:** unit-test `keyDerivation.ts` with fixed vectors (no hardware).

### Phase 2 — Native Card Operations

1. Add `CardInitOptions`, `peekCardUid`, `isCardInitialised`, `initCard`, `readCardSecret`, `cardFreeMemory`, `formatCard`, `getCardApplicationIds` to `INfcReader.h` and `NfcService`.
2. Implement all methods in `Pn532Adapter.cc` including full `initCard` sequence (UID disable + key rotation + write).
3. Add 7 `AsyncWorker` subclasses in `NfcCppBinding.cc` and register in `Init()`.
4. `npm run build:addon` — zero compile errors.

### Phase 3 — IPC Wiring

1. Extend `types.d.ts` with all new DTOs, IPC handlers, and push events.
2. Implement `cardHandlers.ts`: `card:isInitialised`, `card:init`, `card:format` (+ DB wipe), `card:freeMemory`, `card:getApplicationIds`.
3. Implement `vaultHandlers.ts`:
   - `vault:listEntries` — plaintext DB read, no card.
   - `vault:getEntry` — probe loop → read secret → decrypt → zeroize → return.
   - `vault:createEntry` / `vault:updateEntry` — probe loop → read secret → encrypt → store → zeroize.
   - `vault:deleteEntry` — plain DB delete, no card.
   - `vault:cancelCardWait` — abort active probe loop via a shared `AbortController`.
4. Expose all new channels in `preload.cts`.
5. Register both handler files in `main.ts`.
6. `npx tsc --noEmit` — zero errors.

### Phase 4 — UI Integration

1. Add `CardPage.tsx` and `/card` route (init, format with double-confirm, free memory, app ID list).
2. Add Card nav item to `Sidebar.tsx` (`CreditCard` icon from lucide-react).
3. Build `TapCardOverlay.tsx` — reusable, driven by `vault:awaitingCard` / `vault:cardDetected` push events; Cancel button calls `vault:cancelCardWait`.
4. Wire `PasswordsPage.tsx` copy/view actions to `vault:getEntry` + overlay.
5. Wire add/edit modal to `vault:createEntry` / `vault:updateEntry` + overlay.
6. **Verify:** full CRUD cycle with real NFC card.

### Phase 5 — Hardening and QA

1. Error code UX copy: `NO_CARD` timeout, `WRONG_KEY` (wrong card), `READER_BUSY`, `READER_NOT_CONNECTED`, `CARD_NOT_INITIALISED`.
2. `card:format` double-confirm dialog with "I understand" checkbox before call.
3. Handle `safeStorage` unavailable gracefully with an error screen.
4. Smoke tests: list without card, get entry with card, cancel overlay mid-wait, wrong card attempt.
5. Recovery flow: card not initialised modal pointing to Card Page.

---

## 13. Security Checklist

- [ ] `safeStorage` availability checked on startup; app fails closed if unavailable.
- [ ] `machineSecret` never leaves main process.
- [ ] `cardSecret` never crosses IPC boundary.
- [ ] `cardSecret` zeroized immediately after per-entry key derivation completes (not deferred to GC).
- [ ] `cardSecret` is never held across async gaps or IPC round-trips.
- [ ] GCM nonce is fresh random 12 bytes per write; no counter or sequential nonce.
- [ ] GCM auth tag always verified on decrypt; tampered blob throws, not silently returns.
- [ ] Distinct HKDF `info` contexts for card keys (`[0x50,0x57,0x4b,role]`) and entry keys (`pwmgr-entry-v1`).
- [ ] Random UID explicitly disabled in `initCard` before any other operation.
- [ ] App keys rotated from default before writing `card_secret`.
- [ ] File 00 communication mode is encrypted (`0x03`), not MAC-only.
- [ ] No secrets in logs, error text, or debug terminal output.
- [ ] Probe loop has hard 15 s timeout; IPC handler never blocks indefinitely.
- [ ] `READER_BUSY` returned if vault operation starts while reader is in use.

---

## 14. Resolved Decisions and Open Questions

Resolved:

- Metadata (`label`, `url`) is plaintext in v1; encrypt in v2 if cloud sync becomes default.
- PICC master key remains default in v1 (documented tradeoff: attacker with a reader can manage PICC-level apps).
- Per-access model: no persistent session. Card is tapped on demand per vault operation.
- `card_secret` lifetime is microseconds (HKDF + AES-GCM only), then immediately zeroized.
- No background presence polling. Probe loop is scoped inside active vault IPC handlers.
- No UID echo in File 00. Successful authentication with derived key proves UID implicitly.
- `card:format` also deletes `vault.db` — no orphaned ciphertexts.
- `vault:deleteEntry` requires no card — row deletion makes derived key permanently unusable.
- `vault:listEntries` requires no card — label and url are plaintext.

Resolved (final):

- Multi-machine migration: manual file copy of `machine.secret` from `userData`. No wizard in v1. Document the file path clearly in the UI (Settings page or Card page).
- Backup card: not supported in v1. Loss of card means loss of all vault entries. Document this clearly.
- DB path: fixed to `app.getPath('userData')/vault.db`. No user-selectable path in v1.

Open: none. Plan is implementation-ready.
