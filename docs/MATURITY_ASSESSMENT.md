# SecurePass — Repository Maturity Assessment

This document provides a structured evaluation of the SecurePass codebase across
six dimensions: Security, UX Design, Simplicity, Ease of Following, Usability,
and Other Factors.  Each section identifies what the project does well, what
needs improvement, and concrete recommendations.

---

## Table of Contents

1. [Security](#1-security)
2. [UX Design](#2-ux-design)
3. [Simplicity](#3-simplicity)
4. [Ease of Following](#4-ease-of-following)
5. [Usability](#5-usability)
6. [Other Factors](#6-other-factors)
7. [Summary Scorecard](#7-summary-scorecard)

---

## 1. Security

### 1.1 What the project gets right

| Area | Detail |
|------|--------|
| **Two-factor hardware binding** | Every entry key is derived from both a 16-byte `cardSecret` (on the NFC card) and a 32-byte `machineSecret` (in the OS keychain). Neither factor alone is sufficient. |
| **AES-256-GCM authenticated encryption** | Each vault entry is encrypted with a unique 32-byte key and a fresh random 12-byte IV.  The 16-byte GCM auth tag detects any ciphertext tampering before decryption. |
| **HKDF-SHA-256 key derivation** | Both card keys and entry keys use RFC 5869 HKDF with distinct `info` strings, preventing cross-purpose key reuse. |
| **Ephemeral key material** | `appMasterKey`, `readKey`, `cardSecret`, and `entryKey` are never written to disk.  `zeroizeBuffer()` overwrites them in memory immediately after use. |
| **No key material in the renderer** | The IPC bridge (preload script) only exposes typed function stubs.  Raw key bytes never cross the main-to-renderer boundary. |
| **OS secure storage** | `machineSecret` is stored via Electron `safeStorage`, which uses DPAPI (Windows), Keychain (macOS), or libsecret (Linux). |
| **DESFire encrypted communication** | File 00 (card secret) is configured with `commMode = 0x03` (full AES session-key encryption + CMAC) at creation time. |
| **Random UID disabled** | `SetConfigurationPicc(0x00)` fixes the card UID during initialisation, which is required for deterministic key derivation. |
| **Vault export stays encrypted** | The JSON export contains raw ciphertext blobs; it is not a plaintext backup. |

### 1.2 Weaknesses and recommendations

| Weakness | Severity | Recommendation |
|----------|----------|---------------|
| **Lock-screen PIN was hashed with plain SHA-256** (no salt, no iterations) | Medium | **Fixed in this PR**: replaced with PBKDF2-SHA-256 (200 000 iterations, 16-byte random salt, stored as `v2:<salt>:<key>`).  All existing SHA-256 hashes are invalidated on next launch and the user is prompted to reset the PIN. |
| **PIN stored in `localStorage`** | Low | `localStorage` is accessible to any renderer script in the same origin.  Because `contextIsolation: true` is set and no external content is loaded, the risk is low.  A future improvement would move the hash to the main process and expose it via a dedicated IPC channel. |
| **No rate-limiting on PIN attempts** | Low | Repeated wrong PIN entry is not throttled.  Consider an exponential back-off delay after N failures. |
| **Clipboard auto-clear is client-side only** | Low | The 30-second clipboard clear timer in `PasswordsPage.tsx` relies on `setTimeout`.  If the app is force-quit the timer is cancelled.  This is a known limitation of all Electron clipboard managers; document it explicitly. |
| **Sync transport is unauthenticated at the HTTP layer** | Medium | The optional sync server currently relies on application-level encrypted blobs but does not enforce TLS in the client SDK.  Add a check that rejects `http://` sync URLs in production builds. |
| **No Content Security Policy (CSP)** | Low–Medium | `electron-builder.json` and `main.ts` do not set a `Content-Security-Policy` header on the BrowserWindow.  Add `default-src 'self'` to prevent accidental remote resource loading. |
| **`nodeIntegration` not explicitly set to `false`** | Info | Electron defaults to `false`, but it is best practice to make it explicit in every `BrowserWindow` creation call for code-review clarity. |

### 1.3 Overall security rating: **B+ (Good)**

The core cryptographic design is professional-grade.  The identified weaknesses are
peripheral (lock screen, CSP) rather than fundamental, and none of them bypass the
hardware-backed entry encryption.

---

## 2. UX Design

### 2.1 What the project gets right

| Area | Detail |
|------|--------|
| **Consistent visual language** | Tailwind CSS v4 with a shared design token set (`bg-card`, `text-hi`, `border-edge`, etc.) gives every screen a coherent look. |
| **Dark / light theme support** | Theme-aware category colour maps (`CATEGORY_COLORS`) and CSS variables adapt all components to both modes. |
| **Animated lock screen** | Spinning gradient border, unlock burst ring, and entrance transition provide polished visual feedback without being distracting. |
| **TapCardOverlay** | A full-screen modal with an animated NFC card icon clearly communicates "tap your card now", removing ambiguity about what the app is waiting for. |
| **Colour-coded categories** | Passwords are tagged with colour-coded pill badges (Development, Finance, Social, etc.) that help users scan a long list quickly. |
| **Avatar gradients** | Service names are deterministically mapped to gradient backgrounds, giving each entry a distinctive visual identity without requiring user-uploaded icons. |
| **Relative date formatting** | "Today", "Yesterday", "3d ago" — human-readable timestamps reduce cognitive load. |
| **Onboarding flow** | A multi-step onboarding screen guides first-time users through reader setup, card initialisation, and PIN creation. |
| **In-line password generator** | A refresh button in the "create entry" modal generates a new password immediately without navigating away. |

### 2.2 Weaknesses and recommendations

| Weakness | Recommendation |
|----------|---------------|
| **No loading skeleton screens** | Long NFC operations show a spinner, but the password list renders nothing while entries are loading.  Add skeleton rows to prevent layout shift. |
| **Error messages are terse** | Many catch blocks surface `e.message` directly (e.g., "Card not found").  Map error codes to user-friendly explanations with a suggested action. |
| **No undo for destructive actions** | Deleting an entry shows a confirmation dialog but provides no undo.  Consider a brief "Undo" toast (5 s) before committing the deletion. |
| **Accessibility (a11y) gaps** | The PIN keypad buttons are `<button>` elements but the dot indicators have no `aria-live` region announcing the fill count to screen readers.  Add `aria-label` and `role="status"` for better screen-reader support. |
| **Mobile / small-screen layout** | The sidebar is desktop-only; no hamburger menu exists for viewports below ~768 px.  While this is an Electron desktop app, window resizing to small sizes breaks the layout. |

### 2.3 Overall UX rating: **B (Good, room for polish)**

The visual design is clean and intentional.  Primary workflows are well-guided.
Accessibility and error-experience polish are the main areas for improvement.

---

## 3. Simplicity

### 3.1 What the project gets right

| Area | Detail |
|------|--------|
| **Clear layer separation** | Five distinct layers: React UI → Electron IPC bridge → main-process handlers → SQLite vault → C++ NFC addon.  Each layer has one responsibility. |
| **Thin IPC surface** | The preload script (`preload.cts`) exposes exactly the functions the UI needs, nothing more.  There are no broad `ipcRenderer.on('*')` catch-alls. |
| **Single responsibility modules** | `keyDerivation.ts` does only crypto.  `vault.ts` does only SQLite CRUD.  `vaultHandlers.ts` wires them together.  Separation is enforced by directory structure. |
| **Small component files** | Most React components are under 200 lines; larger pages (`PasswordsPage.tsx`) are broken into well-named internal components and helpers. |
| **No unnecessary abstractions** | The codebase avoids over-engineering: no redux, no heavy DI container, no complex reactive pipelines where simple async/await suffices. |

### 3.2 Weaknesses and recommendations

| Weakness | Recommendation |
|----------|---------------|
| **`PasswordsPage.tsx` is 800+ lines** | Extract the create/edit modal into its own `EntryModal.tsx` component. |
| **Inline type definitions** | Some IPC types are duplicated between `src/types/` and individual handler files.  Centralise all shared types in `src/types/ipc.d.ts`. |
| **Magic constants scattered** | Timeout values (e.g., `200 ms` poll interval, `15 s` card wait) are hardcoded in multiple places.  Consolidate into a `constants.ts` file. |

### 3.3 Overall simplicity rating: **B+ (Good)**

The architecture avoids accidental complexity.  A few refactors would make the
largest files easier to scan, but the project never feels bloated.

---

## 4. Ease of Following

### 4.1 What the project gets right

| Area | Detail |
|------|--------|
| **Exceptional security documentation** | `SECURITY_ARCHITECTURE.md` is comprehensive: threat model, ASCII architecture diagram, key derivation tree, step-by-step flow diagrams (read, write, format), DESFire communication mode table, algorithm reference, and file/path index.  This is far above average for a project of this size. |
| **Inline doc-comments** | Every exported function in `keyDerivation.ts` and `vault.ts` has a JSDoc comment explaining its contract, why certain decisions were made (e.g., "Empty HKDF salt is intentional"), and what the caller is responsible for (e.g., zeroizing buffers). |
| **Descriptive section headers** | Files use `// ── Section ──────` banner comments that make it easy to jump to the right place in a long file. |
| **Typed IPC surface** | All IPC channels have TypeScript types in `src/types/`, so callers know exactly what to pass and what to expect back. |
| **Clear CI pipeline** | `.github/workflows/` defines quality-check (lint + test) and packaging jobs with named steps, making it easy to understand what runs on each push. |

### 4.2 Weaknesses and recommendations

| Weakness | Recommendation |
|----------|---------------|
| **README was a copy-paste from a template** | **Fixed in this PR**: README now describes SecurePass accurately, including hardware requirements, architecture overview, and build instructions. |
| **No CONTRIBUTING.md** | Add a `CONTRIBUTING.md` explaining how to set up the development environment, how to run tests, and the PR process. |
| **No CHANGELOG** | Track user-visible changes in a `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) conventions. |
| **C++ code lacks doc-comments** | `Pn532Adapter.cc` and the bindings layer have minimal inline comments.  Adding brief comments above each major function would help contributors unfamiliar with DESFire. |
| **No architecture decision records (ADRs)** | Decisions like "why AES-128 for card keys vs AES-256" and "why HKDF over a simple hash" are not recorded.  Even a short `docs/decisions/` folder would help future maintainers. |

### 4.3 Overall ease-of-following rating: **A− (Excellent security docs; peripheral docs need work)**

---

## 5. Usability

### 5.1 What the project gets right

| Area | Detail |
|------|--------|
| **Hardware setup guidance** | NFC Reader page shows firmware version, self-test result, and connection status — giving users actionable feedback when something goes wrong. |
| **Card diagnostics** | `card:freeMemory` and `card:getAids` are exposed as UI commands, letting power users inspect the card state without external tools. |
| **Search and sort** | The password list supports real-time search, four sort modes, and category filtering in a single toolbar row. |
| **Password strength feedback** | The generator shows entropy / complexity hints alongside the generated password. |
| **Auto-clear clipboard** | Copied passwords are cleared from the clipboard after 30 seconds — a practical safety measure. |
| **Vault backup/restore** | Export and import work without requiring a network connection; the exported file is human-inspectable JSON (even if encrypted). |
| **Browser extension** | Optional native-messaging integration with a browser extension allows auto-filling credentials on web pages without manually copying from the app. |
| **Cross-platform packaging** | CI produces `.deb`, `.exe`, and `.dmg` artifacts, lowering the barrier for non-developers to install the app. |

### 5.2 Weaknesses and recommendations

| Weakness | Recommendation |
|----------|---------------|
| **Hardware is required from first launch** | The app shows an error if no NFC reader is detected, but does not allow users to browse their password list (read-only) without a reader.  Consider allowing offline read access when the reader is absent (reveal still requires a card tap). |
| **No TOTP display UI** | `totpSecret` is stored and exported but there is no UI to display the live TOTP code.  Adding a TOTP display would remove the need for a second authenticator app. |
| **Sync server has no official setup guide** | The `sync-server/` directory exists but there is no documentation on how to deploy it.  A `README` inside `sync-server/` or a `docs/SYNC_SETUP.md` would help. |
| **Windows CP210x driver download is silent** | `scripts/download-cp210x.js` downloads a driver during build with no user notification.  This should be documented and ideally moved to a documented step in the installer. |
| **No keyboard shortcut reference** | Power users have no way to discover keyboard shortcuts (if any).  A `?` help overlay or a `Keyboard Shortcuts` section in settings would help. |

### 5.3 Overall usability rating: **B (Good core; TOTP and offline read are notable gaps)**

---

## 6. Other Factors

### 6.1 Code quality

| Factor | Assessment |
|--------|-----------|
| **TypeScript strict mode** | Enabled (`"strict": true`).  No `any` types observed in application code. |
| **ESLint** | Configured with `typescript-eslint`, `react-hooks`, and `react-refresh` plugins.  Runs in CI. |
| **Formatting** | No Prettier or EditorConfig is present; contributors may introduce inconsistent whitespace.  Adding Prettier would eliminate style debates. |
| **Test coverage** | Very low: only three tests exist (`addon.test.ts`), testing a generic template greeting function, not any SecurePass logic.  Cryptographic unit tests for `keyDerivation.ts` and integration tests for `vault.ts` are absent. |
| **C++ code style** | Consistent use of RAII, header guards, and descriptive naming in `native/core/`.  No C++ static analyser (e.g., clang-tidy) is configured. |

### 6.2 Maintainability

| Factor | Assessment |
|--------|-----------|
| **Dependency freshness** | All major dependencies (Electron 38, React 19, Tailwind 4, Vite 7, Vitest 4) are at or near current latest, which is excellent. |
| **Dependency count** | 14 runtime + 16 dev dependencies — reasonable for an Electron + React + C++ project.  No unnecessary libraries were observed. |
| **Outdated tooling** | `electron-rebuild` is listed but the Electron ecosystem now recommends `@electron/rebuild`.  Consider migrating. |
| **Lock file** | `package-lock.json` is committed — correct practice for a deployable application. |
| **`.gitmodules`** | Native C++ libraries are managed as git submodules, keeping the main repo clean. |

### 6.3 CI / CD

| Factor | Assessment |
|--------|-----------|
| **Quality gate** | TypeScript type-check + ESLint + Vitest run on every push and PR.  Fast feedback. |
| **Multi-platform packaging** | Builds `.deb`, `.exe`, and `.dmg` on Ubuntu and Windows runners respectively. |
| **No code coverage reporting** | Vitest's coverage reporter is not configured.  Adding `--coverage` and a minimum threshold would prevent regressions. |
| **No security scanning** | No `npm audit` or dependency vulnerability scanner (e.g., Dependabot) is configured. |
| **No signed releases** | `signAndEditExecutable: false` in `electron-builder.json` means the Windows installer is unsigned.  Code signing is important for end-user trust and OS warnings. |

### 6.4 Overall "other factors" rating: **B (Solid; test coverage and CI hardening needed)**

---

## 7. Summary Scorecard

| Dimension | Score | Key Strengths | Key Gaps |
|-----------|-------|--------------|----------|
| **Security** | B+ | Hardware 2FA, AES-256-GCM, HKDF, ephemeral keys, OS secure storage | CSP missing; sync transport TLS not enforced; PIN rate-limit absent |
| **UX Design** | B | Consistent visual language, animated flows, colour-coded categories | Accessibility gaps, terse error messages, no undo for deletions |
| **Simplicity** | B+ | Clean layer separation, thin IPC surface, no unnecessary abstractions | `PasswordsPage.tsx` too large; magic constants scattered |
| **Ease of Following** | A− | Exceptional `SECURITY_ARCHITECTURE.md`, typed IPC, good inline docs | README was wrong (fixed); no CONTRIBUTING or CHANGELOG; C++ undocumented |
| **Usability** | B | Search/sort, clipboard auto-clear, browser extension, cross-platform | No offline read-only mode; TOTP display missing; sync undocumented |
| **Other (quality/CI)** | B | Strict TypeScript, fresh dependencies, multi-platform CI | Near-zero test coverage; no Prettier; no signed releases; no Dependabot |

### Overall maturity: **B / "Good"**

SecurePass is a well-architected, security-conscious project that demonstrates
professional-grade cryptographic design.  It is not a throwaway prototype: the
key-derivation hierarchy, DESFire initialisation sequence, and IPC sandboxing are
all production-quality decisions.

The main gaps — low test coverage, missing contributing guidelines, absent CSP,
and a few UX polish items — are normal for a project at this stage of development
and are all addressable without architectural changes.
