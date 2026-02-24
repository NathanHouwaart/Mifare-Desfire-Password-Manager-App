# UI Roadmap

## 1. Username Generator

**Goal:** Add a username generator tab alongside the password generator so users can create unique, readable usernames before registering accounts.

**Scope:** UI-only feature. No C++ changes required.

### Proposed UX

- Add a second tab row inside `GeneratorPage` switching between **Password** and **Username** modes.
- Username modes:
  - **Readable** — adjective + noun + optional number (`swift-wolf-42`)
  - **Professional** — first initial + last name style (`n.dev`, `nathand`)
  - **Random** — alphanumeric slug (`xk7m2p`)
- Controls: length/word-count slider, separator selector (`-`, `_`, `.`, none), capitalize toggle.
- Copy button identical to the password output card.

### Implementation plan

```
src/ui/pages/GeneratorPage.tsx
  - Add `mode: 'password' | 'username'` state.
  - Extract current password-gen section into <PasswordGenerator /> subcomponent.
  - Add <UsernameGenerator /> subcomponent with its own word-list and options.
  - Add a two-tab switcher at the top of the page.

src/ui/pages/GeneratorPage.tsx (data)
  - Add ADJECTIVES[] and NOUNS[] word lists (small, ~100 words each, embedded).
  - generateUsername(mode, opts) pure function.
```

### Estimated effort
~3–4 hours of frontend work. No backend, no new deps (word lists are small enough to inline).

---

## 2. First-Start Setup Wizard

**Goal:** Walk new users through (1) setting a PIN, (2) selecting and testing their NFC reader COM port, (3) a mock DESFire firmware compatibility check — before they see the main vault.

**Scope:** UI-only wizard shell. The firmware check step will call the existing `window.electron.connect()` bridge; no new C++ is required.

### Proposed UX

A full-screen step-by-step flow rendered instead of the main app shell when `localStorage.getItem('setup-complete')` is falsy.

| Step | Content |
|------|---------|
| 1. Welcome | App logo + brief description, "Get started" button |
| 2. Set PIN | Reuses `<LockScreen />` in "set new PIN" mode |
| 3. Reader Setup | COM port dropdown + "Test Connection" button (calls `window.electron.connect()`). Can be skipped ("I'll set this up later"). |
| 4. Firmware Check | Shows spinner while querying device; displays a pass/warn/fail badge. Warns if firmware is older than expected version. Skip available. |
| 5. Done | Summary card + "Open Vault" button. Sets `setup-complete = true`. |

### Implementation plan

```
src/ui/Components/SetupWizard.tsx   — new file
  - Renders full-screen overlay, step state machine.
  - Step components: WelcomeStep, PinStep, ReaderStep, FirmwareStep, DoneStep.
  - On completion: localStorage.setItem('setup-complete', 'true'), calls onComplete().

src/ui/App.tsx
  - Add `setupComplete` state (read from localStorage).
  - Render <SetupWizard onComplete={() => setSetupComplete(true)} /> when falsy,
    otherwise render normal <LockScreen> + app shell.

src/electron/preload.cts
  - Expose window.electron.getFirmwareVersion() once the C++ layer supports it.
  - For now the wizard step shows a placeholder "version unavailable" result.
```

### Estimated effort
~6–8 hours. The wizard shell and step UI are straightforward; the firmware check is a stub until the C++ layer exposes a version query.
