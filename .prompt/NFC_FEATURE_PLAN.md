# NFC Reader Feature Connection Plan

## Goal
Wire three real hardware operations into the NFC Reader page:

| UI Card | Hardware Operation | Requires Card |
|---|---|---|
| `FirmwareVersionCard` | `Pn532Driver::getFirmwareVersion()` | No (reader-only) |
| `SelfTestCard` | PN532 self-test across 5 test types | No (reader-only) |
| `CardVersionCard` | DESFire `GetVersionCommand` | Yes (card must be present) |

---

## Current Stack (reference)

```text
React UI -> window.electron.* -> preload.cts -> ipcMain -> NfcCppBinding (C++)
                                                        -> NfcService (core)
                                                        -> INfcReader port
                                                        -> Pn532Adapter (adapter)
                                                        -> Pn532Driver / CardManager (lib)
```

---

## Layer-by-Layer Plan

### Layer 1 - `core/ports/INfcReader.h`

Define the complete contracts in the port so all layers share one source of truth.

```cpp
struct NfcError {
    std::string code;     // NOT_CONNECTED, NO_CARD, NOT_DESFIRE, IO_TIMEOUT, HARDWARE_ERROR
    std::string message;  // human readable detail
};

template <typename T>
using Result = std::variant<T, NfcError>;

enum class TestOutcome { Success, Failed, Skipped };

struct SelfTestResult {
    std::string name;     // canonical name
    TestOutcome outcome;  // Success | Failed | Skipped
    std::string detail;   // populated on failure, empty otherwise
};

struct SelfTestReport {
    // Contract: always 5 rows, fixed order
    std::array<SelfTestResult, 5> results;
    bool allPassed() const;
};

struct CardVersionInfo {
    std::string hwVersion;    // e.g. "1.0"
    std::string swVersion;    // e.g. "1.4"
    std::string uidHex;       // e.g. "04A1B2C3D4E5F6"
    std::string storage;      // e.g. "8 KB"
    std::string rawVersionHex;// optional debug/raw bytes
};

class INfcReader {
public:
    virtual ~INfcReader() = default;
    virtual Result<std::string>   connect(const std::string& port) = 0;
    virtual Result<bool>          disconnect() = 0;
    virtual Result<std::string>   getFirmwareVersion() = 0;
    virtual Result<SelfTestReport> runSelfTests() = 0;
    virtual Result<CardVersionInfo> getCardVersion() = 0;
};
```

Canonical self-test names and order:

1. `ROM Check`
2. `RAM Check`
3. `Communication`
4. `Echo Test`
5. `Antenna`

---

### Layer 2 - `core/services/NfcService`

Add passthrough methods only (no business logic):

```cpp
Result<std::string>    getFirmwareVersion();
Result<SelfTestReport> runSelfTests();
Result<CardVersionInfo> getCardVersion();
```

Important migration rule:

- Every existing and new `NfcError` return in service methods must use both fields:
  - `NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"}`

No single-field `NfcError{"..."}` initializers remain after migration.

---

### Layer 3 - `adapters/hardware/Pn532Adapter`

All public adapter methods stay serialized behind `_mutex`.

#### 3a) `getFirmwareVersion()`

- Require `_pn532` present, otherwise `NfcError{"NOT_CONNECTED", ...}`.
- Call driver API.
- Convert driver error categories to contract codes:
  - timeout -> `IO_TIMEOUT`
  - other -> `HARDWARE_ERROR`
- Return formatted firmware string.

#### 3b) `runSelfTests()` (continue-all)

- Always run all 5 tests in canonical order.
- Never abort loop on first failure.
- Always return exactly 5 rows.
- Current mode never emits `Skipped`; reserved for future fail-fast feature.

Pseudo-shape:

```cpp
for each canonical test:
  run test command
  if success: outcome = Success, detail = ""
  else:       outcome = Failed, detail = "<code>: <message>"
```

#### 3c) `getCardVersion()`

Use `CardManager::detectCard()` as the single detection entry point.

Do not pre-call `_pn532->inListPassiveTarget()` before `detectCard()`.

Flow:

1. Build APDU adapter and `CardManager`.
2. Call `detectCard()`.
3. If no card, return `NfcError{"NO_CARD", "No card detected"}`.
4. Validate DESFire compatibility; otherwise `NOT_DESFIRE`.
5. Open session.
6. Execute `GetVersionCommand`.
7. Map parsed bytes to `CardVersionInfo` fields (`hwVersion`, `swVersion`, `uidHex`, `storage`, `rawVersionHex`).
8. Close session and return.

---

### Layer 4 - `bindings/node/NfcCppBinding`

Add workers:

- `GetFirmwareVersionWorker`
- `RunSelfTestsWorker`
- `GetCardVersionWorker`

`RunSelfTestsWorker::OnOK` returns:

```js
{
  results: [
    { name: "ROM Check", status: "success", detail: "" },
    { name: "RAM Check", status: "failed", detail: "IO_TIMEOUT: Command timed out" },
    { name: "Communication", status: "success", detail: "" },
    { name: "Echo Test", status: "success", detail: "" },
    { name: "Antenna", status: "success", detail: "" }
  ]
}
```

`GetCardVersionWorker::OnOK` returns object:

```js
{
  hwVersion: "1.0",
  swVersion: "1.4",
  uidHex: "04A1B2C3D4E5F6",
  storage: "8 KB",
  rawVersionHex: "...."
}
```

Error propagation rule (all workers):

- Reject `Napi::Error` with:
  - `error.message = NfcError.message`
  - `error.code = NfcError.code` (explicit property)

Do not encode `code` into message text and parse it later.

---

### Layer 5 - TypeScript IPC (`src/electron`)

#### 5a) `types.d.ts`

```ts
type SelfTestStatus = 'success' | 'failed' | 'skipped';
type SelfTestResultDto = { name: string; status: SelfTestStatus; detail: string };
type SelfTestReportDto = {
  results: [SelfTestResultDto, SelfTestResultDto, SelfTestResultDto, SelfTestResultDto, SelfTestResultDto];
};

type CardVersionInfoDto = {
  hwVersion: string;
  swVersion: string;
  uidHex: string;
  storage: string;
  rawVersionHex: string;
};

type IPCHandlers = {
  // existing...
  getFirmwareVersion: () => Promise<string>;
  runSelfTests: () => Promise<SelfTestReportDto>;
  getCardVersion: () => Promise<CardVersionInfoDto>;
};
```

#### 5b) `bindings.ts` and `preload.cts`

Expose:

- `getFirmwareVersion()`
- `runSelfTests()`
- `getCardVersion()`

with the DTO return types above.

#### 5c) `main.ts` runtime validation (required)

Before returning native payloads to renderer, validate shape at runtime:

- `isSelfTestReportDto(payload)`:
  - `results` exists
  - length is exactly 5
  - names match canonical order
  - status in `success|failed|skipped`
- `isCardVersionInfoDto(payload)`:
  - all required string fields present

If validation fails, throw:

- `Error` with `code = "HARDWARE_ERROR"` and a clear message.

This closes the native/IPC runtime gap that compile-time tuple typing cannot enforce.

---

### Layer 6 - React UI (`src/ui`)

#### `NfcReaderPage.tsx`

- Replace stubs with real `window.electron.*` calls.
- Rename state from debug to card naming (`cardVersion`, `cardLoading`, etc).
- Stable self-test mapping with canonical ID map, not string transforms:

```ts
const TEST_ID_BY_NAME: Record<string, string> = {
  'ROM Check': 'rom',
  'RAM Check': 'ram',
  'Communication': 'communication',
  'Echo Test': 'echo',
  'Antenna': 'antenna',
};
```

#### `SelfTestCard.tsx`

- Keep `'skipped'` support (icon + neutral style).

#### `CardVersionCard.tsx`

- Render structured fields as labeled rows:
  - Hardware Version
  - Software Version
  - UID
  - Storage
- Optionally show raw hex in a collapsible/secondary row.

#### UI error handling

- Read `error.code` from rejected error object.
- Show targeted copy:
  - `NO_CARD`: "Tap a DESFire card and try again."
  - `NOT_DESFIRE`: "Card detected but not DESFire-compatible."
  - `NOT_CONNECTED`: "Connect to PN532 first."

---

## Error Code Contract

| Code | Trigger |
|---|---|
| `NOT_CONNECTED` | Called before successful `connect()` |
| `NO_CARD` | No card detected |
| `NOT_DESFIRE` | Card detected but not DESFire compatible |
| `IO_TIMEOUT` | Serial/NFC timeout |
| `HARDWARE_ERROR` | Any other native/driver failure |

---

## Implementation Order

1. Update `INfcReader` contracts: `NfcError` fields, self-test DTOs, `CardVersionInfo`, new methods.
2. Migrate all existing `NfcError` returns to `{code, message}` in current connect/disconnect paths.
3. Add `NfcService` passthroughs for new methods.
4. Implement `Pn532Adapter` methods with mutex, canonical test order, and code mapping.
5. Extend `NfcCppBinding` with 3 workers and `error.code` propagation.
6. Extend `types.d.ts`, `bindings.ts`, `preload.cts`.
7. Add `ipcMain.handle` implementations in `main.ts` with runtime DTO guards.
8. Replace UI stubs in `NfcReaderPage.tsx`.
9. Render structured card version data in `CardVersionCard.tsx`.
10. Manual smoke test:
   - connect -> firmware
   - run self-tests
   - tap DESFire card -> card version
   - tap non-DESFire card -> `NOT_DESFIRE`
   - no card -> `NO_CARD`

---

## Acceptance Criteria

- Self-test API always returns exactly 5 canonical rows in stable order.
- Card version API returns structured object (not free-form string).
- No remaining single-field `NfcError` initializers.
- Renderer receives machine-readable `error.code`.
- Runtime payload guards reject malformed native payloads before renderer use.
