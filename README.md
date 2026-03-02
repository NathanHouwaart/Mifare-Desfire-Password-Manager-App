# SecurePass — NFC Password Manager

A hardware-backed password manager that uses a **MIFARE DESFire EV2 NFC card** as a physical security key. Every password is encrypted with a key derived from both the card and the host machine — a stolen card or a stolen machine alone cannot decrypt anything.

## Features

- **Two-factor hardware security**: Each entry key requires the physical NFC card _and_ the machine secret stored in the OS keychain (DPAPI / Keychain / libsecret).
- **AES-256-GCM encryption**: All vault entries are encrypted with authenticated encryption; tampered ciphertexts are detected and rejected.
- **Zero key-at-rest**: No key material is ever written to disk or sent to the renderer process; all ephemeral keys are zeroized immediately after use.
- **Password generator**: Configurable rules for length, character classes, and entropy.
- **Optional remote sync**: Pull/push encrypted blobs to a self-hosted sync server; plaintext never leaves the device.
- **Lock screen**: PIN-protected inactivity lock (PBKDF2-SHA-256, 200 000 iterations).
- **Vault export / import**: Portable encrypted backup — readable only with the original card and machine.
- **Cross-platform**: Windows, macOS, and Linux (CI builds `.exe`, `.dmg`, `.deb`).
- **Browser extension**: Optional native-messaging host for web credential fill.

## Security Architecture

See [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md) for a full description of the threat model, key-derivation hierarchy, DESFire initialisation sequence, and memory-hygiene guarantees.

## Hardware Requirements

| Component | Specification |
|-----------|--------------|
| NFC reader | PN532 connected via UART (USB–serial adapter, CP210x driver on Windows) |
| NFC card | MIFARE DESFire EV2 (ISO 14443-A, AES-capable) |

## Prerequisites

To build the native C++ addon, your system needs:

- **Node.js** v20.19+ or v22.12+
- **Python 3**
- **CMake** 3.15+
- **C++ compiler**:
  - *Windows*: Visual Studio — "Desktop development with C++" workload
  - *macOS*: Xcode Command Line Tools (`xcode-select --install`)
  - *Linux*: GCC/G++ and Make (`sudo apt install build-essential`)

## Getting Started

```bash
# 1. Install dependencies (also rebuilds the native addon for your Electron version)
npm install

# 2. Build the C++ NFC addon
npm run build:addon

# 3. Start the development server
npm run dev
```

## Building for Distribution

```bash
npm run dist:linux   # → dist/SecurePass-*.deb
npm run dist:win     # → dist/SecurePass-Setup-*.exe
npm run dist:mac     # → dist/SecurePass-*.dmg  (arm64)
```

## Running Tests & Linting

```bash
npm test       # Vitest unit tests
npm run lint   # ESLint
```

## Project Structure

```
src/
  electron/         Main process: IPC handlers, key derivation, vault CRUD, NFC bindings
  ui/               React + Tailwind frontend (pages, components, hooks)
  types/            Shared TypeScript IPC definitions
native/
  core/             Pure C++ business logic (no Node.js dependency)
  adapters/         Hardware driver (PN532 UART)
  bindings/         N-API wrappers that expose C++ to JavaScript
tests/              Vitest unit tests
docs/               Architecture and security documentation
```
