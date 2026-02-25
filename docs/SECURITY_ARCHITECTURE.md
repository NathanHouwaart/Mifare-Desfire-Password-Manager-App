# SecurePass — Security Architecture

> This document describes every cryptographic decision made in SecurePass: how
> cards are initialised, what is stored where, how entry keys are derived, and
> what the complete read/write flows look like from button-press to plaintext.

---

## Table of Contents

1. [Threat Model & Design Goals](#1-threat-model--design-goals)
2. [Components Overview](#2-components-overview)
3. [Secret Inventory](#3-secret-inventory)
4. [Card Initialisation](#4-card-initialisation)
   - [4.1 What the PN532 and DESFire card require](#41-what-the-pn532-and-desfire-card-require)
   - [4.2 Eleven-step initialisation sequence](#42-eleven-step-initialisation-sequence-c-layer)
   - [4.3 DESFire Communication Modes](#43-desfire-communication-modes)
5. [Key Derivation Hierarchy](#5-key-derivation-hierarchy)
6. [Vault Database](#6-vault-database)
7. [Entry Encryption](#7-entry-encryption)
8. [Read Flow — Decrypting an Entry](#8-read-flow--decrypting-an-entry)
9. [Write Flow — Creating / Updating an Entry](#9-write-flow--creating--updating-an-entry)
10. [Card Format & Vault Wipe](#10-card-format--vault-wipe)
11. [Vault Backup & Restore](#11-vault-backup--restore)
12. [Memory Hygiene](#12-memory-hygiene)
13. [Algorithm Reference](#13-algorithm-reference)
14. [File & Path Reference](#14-file--path-reference)

---

## 1. Threat Model & Design Goals

| Goal | Mechanism |
|------|-----------|
| Passwords unreadable without the physical NFC card | Every entry key is derived from a 16-byte secret stored **only on the card** |
| Passwords unreadable on a stolen machine even with the card | Entry key also requires the **machine secret** from OS secure storage (DPAPI / Keychain / libsecret) |
| A card stolen without the machine is useless | Read key is derived from machine secret + card UID — the attacker cannot authenticate |
| Individual entry keys are independent | Entry UUID is mixed into HKDF as the salt — compromising one entry reveals nothing about others |
| Ciphertext cannot be silently tampered | AES-256-GCM provides authenticated encryption; decryption throws on auth-tag mismatch |
| NFC card cannot be cloned without the machine | App keys are bound to `machineSecret + UID`; they cannot be re-derived on another device |

---

## 2. Components Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Electron Main Process                           │
│                                                                         │
│  ┌──────────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │  keyDerivation   │   │  vaultHandlers   │   │  cardHandlers      │  │
│  │  (HKDF, AES-GCM) │◄──│  (IPC handlers)  │──►│  (init, format)    │  │
│  └──────────────────┘   └────────┬─────────┘   └────────┬───────────┘  │
│                                  │                       │              │
│  ┌──────────────────┐            │              ┌────────▼───────────┐  │
│  │  vault.db        │◄───────────┘              │  NfcCppBinding     │  │
│  │  (SQLite, BLOB)  │                           │  (C++ / PN532)     │  │
│  └──────────────────┘                           └────────┬───────────┘  │
│                                                          │              │
│  ┌──────────────────┐                                    │              │
│  │  machine.secret  │                                    │              │
│  │  (safeStorage)   │                                    │              │
│  └──────────────────┘                                    │              │
└──────────────────────────────────────────────────────────│──────────────┘
                                                           │ UART / Serial
                                              ┌────────────▼──────────────┐
                                              │  PN532 NFC Reader         │
                                              └────────────┬──────────────┘
                                                           │ ISO 14443-A
                                              ┌────────────▼──────────────┐
                                              │  MIFARE DESFire EV2 Card  │
                                              │  AID 505700               │
                                              │  File 00: card_secret     │
                                              └───────────────────────────┘
```

---

## 3. Secret Inventory

| Secret | Size | Where stored | When created | Lifetime |
|--------|------|-------------|-------------|---------|
| `machineSecret` | 32 bytes | OS secure storage (`machine.secret`, encrypted) | First app launch | Permanent — tied to this machine |
| `cardSecret` | 16 bytes | DESFire File 00 (authenticated read) | Card init | Permanent — lives on card |
| `appMasterKey` | 16 bytes | **Nowhere** — re-derived on every use | — | Ephemeral — derived in memory, zeroized |
| `readKey` | 16 bytes | **Nowhere** — re-derived on every use | — | Ephemeral — derived in memory, zeroized |
| `entryKey` | 32 bytes | **Nowhere** — derived per-operation | — | Ephemeral — derived in memory, zeroized |

> **No key material is ever written to disk or sent to the renderer process.**

---

## 4. Card Initialisation

Triggered by: **Card Management → Initialise Card** (user must tap the card).

### 4.1 What the PN532 and DESFire card require

| Parameter | Value | Source |
|-----------|-------|--------|
| AID (Application Identifier) | `50 57 00` (hex) | Hardcoded constant `VAULT_AID` |
| Key count | 2 | Fixed |
| Key type | AES-128 | `DesfireKeyType::AES` |
| File ID | `00` | Fixed |
| File type | Encrypted Backup Data File | `createBackupDataFile` |
| File size | 32 bytes | 16 B card_secret + 16 B reserved |
| File access — Read | Key 1 (read key) | |
| File access — Write | Key 0 (app master key) | |
| File access — ReadWrite | Key 0 | |
| File access — Change | Key 0 | |
| Random UID | **Disabled** | `setConfigurationPicc(0x00)` |

### 4.2 Eleven-step initialisation sequence (C++ layer)

```
Step  1  SelectApplication(PICC AID 000000)
Step  2  Authenticate(keyNo=0, default AES all-zero key, mode=ISO)
Step  3  SetConfigurationPicc(0x00)           — disables random UID
Step  4  CreateApplication(AID=505700,
           accessRights=0x0F, keyCount=2, keyType=AES)
Step  5  SelectApplication(AID=505700)
Step  6  Authenticate(keyNo=0, default AES all-zero key, mode=AES)
Step  7  CreateBackupDataFile(fileNo=0, commMode=0x03[encrypted],
           readKey=1, writeKey=0, rwKey=0, changeKey=0, size=32)
Step  8  ChangeKey(keyNo=1, newKey=readKey, keyVersion=1)
Step  9  ChangeKey(keyNo=0, newKey=appMasterKey, keyVersion=0)  ← self-change
Step 10  Authenticate(keyNo=0, newAppMasterKey, mode=AES)
Step 11  WriteData(fileNo=0, offset=0,
           data = cardSecret[0..15] ‖ 0x00*16)
         CommitTransaction()
```

After step 11 the card carries:
- **Key 0** — app master key (derived, never stored externally)
- **Key 1** — read key (derived, never stored externally)
- **File 00** — 32 bytes: `cardSecret` (16 B) + padding zeros (16 B)

### 4.3 DESFire Communication Modes

DESFire EV2 defines three communication modes that govern how each command's
data is protected on the RF channel.  The mode for a file is fixed at creation
time and applies to every subsequent read/write of that file.

| Mode value | Name | Wire protection | Used by |
|-----------|------|----------------|---------|
| `0x00` | **Plain** | No protection — data sent in the clear | `SelectApplication`, `GetApplicationIDs`, `GetVersion` |
| `0x01` | **MACed** | CMAC appended; data visible but tamper-evident | `SetConfiguration`, `CreateApplication`, `ChangeFileSettings` |
| `0x03` | **Encrypted** | Full AES session-key encryption + CMAC | File 00 `ReadData` / `WriteData`, `ChangeKey` |

#### Per-operation breakdown

| Operation | Mode | Reason |
|-----------|------|--------|
| `SelectApplication(PICC / AID)` | Plain | Selection command has no payload to protect |
| `Authenticate(keyNo, key, AES)` | — (protocol itself) | Three-pass AES challenge-response; establishes session key |
| `SetConfigurationPicc(0x00)` (disable random UID) | MACed | PICC-level config change, authenticated after ISO auth |
| `CreateApplication(AID, ...)` | MACed | Structural command; no sensitive payload |
| `CreateBackupDataFile(commMode=0x03, ...)` | **Encrypted** | `commMode` byte `0x03` baked into file descriptor at creation |
| `ChangeKey(keyNo, newKey)` | **Encrypted** | Always fully encrypted per DESFire spec; new key wrapped in session key |
| `WriteData(file=0, cardSecret)` | **Encrypted** | Inherits file's `commMode=0x03`; session key from step 10 auth |
| `CommitTransaction()` | MACed | Commit signal; CMAC checked by card |
| `ReadData(file=0, 16 B)` | **Encrypted** | Inherits file's `commMode=0x03`; session key from read-key auth |
| `FormatPICC` | Plain (PICC default key) | Destroys all apps — no file payload; PICC must allow it |

#### Session key lifetime

A session key is ephemeral — derived by both sides during `Authenticate` using
the shared AES key and two random nonces.  It exists only for the duration of
that card session; a new authenticate step produces a new session key.  The
session key is **never stored** anywhere.

```
Authenticate(keyNo, AES-128 key)
  Card  ──► rndB (8 B, encrypted)
  Host  ──► rndA ‖ rndB' (16 B, encrypted with shared key)
  Card  ──► rndA' (8 B, encrypted)
  Both sides compute:
    SessionKey = rndA[0..3] ‖ rndB[0..3] ‖ rndA[12..15] ‖ rndB[12..15]
                 (AES-128, used for all subsequent Encrypted commands)
```

---

## 5. Key Derivation Hierarchy

All derivations use **HKDF-SHA-256** (RFC 5869) via Node.js `crypto.hkdfSync`.

```
╔══════════════════════════════════════════════════════════════════════════╗
║                      Key Derivation Tree                                ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║   machineSecret (32 B)  ──┐                                             ║
║   cardUID        (4/7 B)  ├─► HKDF-SHA256 ──► appMasterKey (16 B AES)  ║
║   info = "PWK" + 0x01     │                    (DESFire Key 0)          ║
║                           │                                             ║
║   machineSecret (32 B)  ──┐                                             ║
║   cardUID        (4/7 B)  ├─► HKDF-SHA256 ──► readKey      (16 B AES)  ║
║   info = "PWK" + 0x02     │                    (DESFire Key 1)          ║
║                                                                         ║
║   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   ║
║                                                                         ║
║   cardSecret    (16 B)  ──┐                                             ║
║   machineSecret (32 B)    ├─► HKDF-SHA256 ──► entryKey     (32 B AES)  ║
║   salt = entryId (UUID)   │   info = "pwmgr-entry-v1"       (per entry) ║
║                                                                         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### 5.1 Card key derivation (appMasterKey / readKey)

```
IKM  = machineSecret ‖ UID          (concatenation, no separator)
salt = (empty — UID is already mixed into IKM)
info = [0x50, 0x57, 0x4B, role]     ("PWK" + role byte)
L    = 16 bytes
```

| Role byte | Output key |
|-----------|-----------|
| `0x01` | appMasterKey (Key 0) |
| `0x02` | readKey (Key 1) |

### 5.2 Entry key derivation

```
IKM  = cardSecret ‖ machineSecret   (concatenation)
salt = entryId (UTF-8 bytes of the UUID string)
info = "pwmgr-entry-v1"
L    = 32 bytes
```

Each entry UUID is pre-generated with `crypto.randomUUID()` **before** the key
derivation call, ensuring every entry has a permanently independent key from the
first write.

---

## 6. Vault Database

**File**: `<Electron userData>/vault.db` (SQLite, WAL mode)

### 6.1 Schema (current: v2)

```sql
CREATE TABLE schema_version (
  version  INTEGER NOT NULL
);

CREATE TABLE entries (
  id          TEXT    PRIMARY KEY,         -- UUID v4
  label       TEXT    NOT NULL,
  url         TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',  -- added in migration v2
  created_at  INTEGER NOT NULL,            -- Unix ms
  updated_at  INTEGER NOT NULL,            -- Unix ms
  ciphertext  BLOB    NOT NULL,            -- AES-256-GCM ciphertext
  iv          BLOB    NOT NULL,            -- 12-byte random nonce
  auth_tag    BLOB    NOT NULL             -- 16-byte GCM authentication tag
);

CREATE INDEX idx_entries_label   ON entries(label COLLATE NOCASE);
CREATE INDEX idx_entries_updated ON entries(updated_at DESC);
```

### 6.2 Schema migration history

| Version | Change |
|---------|--------|
| v0 → v1 | Initial schema: entries table + indexes |
| v1 → v2 | Added `category` column (`TEXT NOT NULL DEFAULT ''`) |

### 6.3 What is NOT in the database

- No plaintext passwords, usernames, notes, or TOTP secrets — ever.
- No keys, IVs used across entries, or card UIDs.
- No machine secret or card secret.

---

## 7. Entry Encryption

Each entry's sensitive payload is:

```json
{
  "username":   "alice@example.com",
  "password":   "hunter2",
  "totpSecret": "JBSWY3DPEHPK3PXP",   // optional
  "notes":      "Created 2025-01-01"   // optional
}
```

The object is serialised to JSON, then encrypted with **AES-256-GCM**:

```
key        = entryKey   (32 bytes, derived on card tap — see §5.2)
iv         = crypto.randomBytes(12)   ← fresh nonce per write
plaintext  = JSON.stringify(payload)
ciphertext, authTag = AES-256-GCM.encrypt(key, iv, plaintext)
```

Three BLOBs are stored in `entries`: `ciphertext`, `iv`, `auth_tag`.

> The IV is **never reused** — a new random 12-byte value is generated for every
> `encryptEntry` call, including on updates to existing entries.

---

## 8. Read Flow — Decrypting an Entry

```
UI clicks "Reveal"
        │
        ▼
  vault:getEntry(id)  ────────────────────────────────────► IPC to main
                                                                │
                                                    getEntryRow(id) from SQLite
                                                                │
                                                  "Tap card to decrypt…" overlay
                                                                │
                                                    ┌───────────▼──────────────┐
                                                    │  waitForCard()           │
                                                    │  polls peekCardUid()     │
                                                    │  every 200 ms, 15 s max  │
                                                    └───────────┬──────────────┘
                                                                │  uidHex
                                                    ┌───────────▼──────────────┐
                                                    │  deriveCardKey(          │
                                                    │    machineSecret,        │
                                                    │    UID, role=0x02)       │
                                                    │  ──► readKey (16 B)      │
                                                    └───────────┬──────────────┘
                                                                │
                                                    ┌───────────▼──────────────┐
                                                    │  nfcBinding              │
                                                    │  .readCardSecret(readKey)│
                                                    │                          │
                                                    │  DESFire sequence:       │
                                                    │  SelectApp(505700)       │
                                                    │  Authenticate(1, readKey)│
                                                    │  ReadData(file=0,        │
                                                    │    offset=0, length=16)  │
                                                    │  ──► cardSecret (16 B)   │
                                                    └───────────┬──────────────┘
                                                    zeroize readKey
                                                                │
                                                    ┌───────────▼──────────────┐
                                                    │  deriveEntryKey(         │
                                                    │    cardSecret,           │
                                                    │    machineSecret,        │
                                                    │    entryId)              │
                                                    │  ──► entryKey (32 B)     │
                                                    └───────────┬──────────────┘
                                                    zeroize cardSecret
                                                                │
                                                    ┌───────────▼──────────────┐
                                                    │  decryptEntry(           │
                                                    │    entryKey,             │
                                                    │    ciphertext, iv,       │
                                                    │    authTag)              │
                                                    │  AES-256-GCM.decrypt     │
                                                    │  GCM auth tag verified   │
                                                    │  JSON.parse              │
                                                    │  ──► EntryPayload        │
                                                    └───────────┬──────────────┘
                                                    zeroize entryKey
                                                                │
                                                    EntryPayloadDto sent to renderer
        │
        ▼
 Revealed panel (username / password visible)
 Clipboard auto-clear timer starts (30 s)
```

---

## 9. Write Flow — Creating / Updating an Entry

```
User fills form and clicks Save
        │
        ▼
  vault:createEntry(params)  ─────────────────────────────► IPC to main
                                                                │
                                                  id = crypto.randomUUID()
                                                                │
                                                  Same card tap + key derivation
                                                  as §8 (steps 1–5)
                                                                │
                                                    ┌───────────▼──────────────┐
                                                    │  encryptEntry(           │
                                                    │    entryKey, {           │
                                                    │      username, password, │
                                                    │      totpSecret, notes}) │
                                                    │                          │
                                                    │  iv = randomBytes(12)    │
                                                    │  AES-256-GCM.encrypt     │
                                                    │  ──► ciphertext,         │
                                                    │      iv, authTag         │
                                                    └───────────┬──────────────┘
                                                    zeroize entryKey
                                                                │
                                                    insertEntry(id, {
                                                      label, url, category,
                                                      ciphertext, iv, authTag
                                                    }) into SQLite
                                                                │
                                                    EntryListItemDto (no blobs)
                                                    returned to renderer
        │
        ▼
 Entry appears in password list
```

> **Update flow** (`vault:updateEntry`) is identical except `id` is the
> existing UUID and `updateEntry()` is called instead of `insertEntry()`. A
> fresh IV is always generated — old ciphertext is fully replaced.

---

## 10. Card Format & Vault Wipe

```
User types "format and wipe" → clicks Confirm → taps card
        │
        ▼
  card:format  ──────────────────────────────────────────► IPC to main
                                                                │
                                                    nfcBinding.formatCard()
                                                                │
                                                    DESFire: FormatPICC
                                                    (destroys ALL applications,
                                                     files, and resets all keys
                                                     to factory defaults)
                                                                │
                                                    wipeVault()
                                                    DELETE FROM entries
                                                                │
                                                    Returns true
        │
        ▼
 Card: clean factory state — no AID 505700, no card_secret
 Vault DB: empty (schema and indexes intact)
```

**Why this is irreversible**: The card secret is gone from the hardware.
All `entryKey` values are derived from it, so all ciphertexts are permanently
unreadable even if the database rows could be recovered from disk.

---

## 11. Vault Backup & Restore

### 11.1 Export

`vault:export` writes a JSON file via the native Save dialog:

```json
{
  "version": 1,
  "appVersion": "0.1.0",
  "exportedAt": "2026-02-25T12:00:00.000Z",
  "note": "Restore requires the original NFC card and device.",
  "entries": [
    {
      "id": "<UUID>",
      "label": "GitHub",
      "url": "https://github.com",
      "category": "Dev",
      "createdAt": 1700000000000,
      "updatedAt": 1700000001000,
      "ciphertext": "<base64>",
      "iv": "<base64>",
      "authTag": "<base64>"
    }
  ]
}
```

**Ciphertexts are exported verbatim** — they remain encrypted. The file is not
a plaintext backup; it is a portable copy of the database rows.

### 11.2 Import / Restore

`vault:import` reads the file, validates the schema, and calls `insertEntryRaw()`
for each entry. Entries whose UUID already exists in the local database are
**skipped silently** (no overwrite), so import is always safe to run on a
non-empty vault.

### 11.3 Portability constraints

| Constraint | Reason |
|-----------|--------|
| Same physical NFC card required | `cardSecret` is on the card |
| Same machine required | `machineSecret` component of `entryKey` |
| Different machine = permanent loss | `entryKey = f(cardSecret, machineSecret, id)` — neither factor is in the backup |

A backup is useful for **database recovery** (corrupted DB, reinstall) not as a
cross-device migration path.

---

## 12. Memory Hygiene

All ephemeral key buffers are explicitly overwritten with zeroes after use
via `zeroizeBuffer(buf)`:

```typescript
export function zeroizeBuffer(buf: Buffer): void {
  buf.fill(0);
}
```

Zeroized in every flow:
- `readKey` — after `readCardSecret()` returns
- `cardSecretBuf` — after `deriveEntryKey()` returns
- `entryKey` — in the `finally` block after encrypt/decrypt
- `appMasterKey`, `readKey`, `cardSecret` — in `card:init` `finally` block

Key material is **never** sent to the renderer process — `EntryPayloadDto` is
the only payload returned to the UI, and it contains only the decrypted field
values, not any key material.

---

## 13. Algorithm Reference

| Operation | Algorithm | Key size | Parameters |
|-----------|-----------|----------|------------|
| DESFire app key derivation | HKDF-SHA-256 | 16 bytes output | IKM = machineSecret ‖ UID ; salt = ∅ ; info = `PWK` + role |
| Entry key derivation | HKDF-SHA-256 | 32 bytes output | IKM = cardSecret ‖ machineSecret ; salt = entryId (UTF-8) ; info = `pwmgr-entry-v1` |
| DESFire authentication | AES-128 three-pass | 128 bits | ISO or native AES mode ; produces 128-bit session key |
| DESFire session key | AES-128 | 128 bits | `rndA[0..3] ‖ rndB[0..3] ‖ rndA[12..15] ‖ rndB[12..15]` ; ephemeral, per-session |
| DESFire file comm mode | Plain / MACed / Encrypted | — | `0x00` plain, `0x01` CMAC-only, `0x03` full AES encryption + CMAC |
| File 00 ReadData / WriteData | AES-128 (session key) + CMAC | 128 bits | commMode `0x03` — data fully encrypted on the RF channel |
| ChangeKey command | AES-128 (session key) | 128 bits | Always Encrypted per DESFire spec ; new key wrapped in session key |
| Entry encrypt / decrypt | AES-256-GCM | 256 bits | IV = 12 B random ; auth tag = 16 B |
| Machine secret storage | OS safeStorage | 32 bytes | DPAPI (Windows), Keychain (macOS), libsecret (Linux) |
| PIN hashing (lock screen) | SHA-256 | — | Browser `crypto.subtle.digest` ; stored in `localStorage` |

---

## 14. File & Path Reference

| File | Path | Contents |
|------|------|----------|
| `vault.db` | `<userData>/vault.db` | SQLite — encrypted entry rows |
| `machine.secret` | `<userData>/machine.secret` | OS-encrypted 32-byte machine secret |
| `keyDerivation.ts` | `src/electron/keyDerivation.ts` | HKDF, AES-256-GCM encrypt/decrypt, zeroizeBuffer |
| `cardHandlers.ts` | `src/electron/cardHandlers.ts` | IPC: card:init, card:format, card:probe, card:freeMemory, card:getAids |
| `vaultHandlers.ts` | `src/electron/vaultHandlers.ts` | IPC: vault:getEntry, vault:createEntry, vault:updateEntry, vault:deleteEntry, vault:export, vault:import |
| `vault.ts` | `src/electron/vault.ts` | SQLite CRUD — blobs only, no crypto |
| `main.ts` | `src/electron/main.ts` | App entry, machine secret init, connect/disconnect IPC |
| `Pn532Adapter.cc` | `native/adapters/hardware/Pn532Adapter.cc` | C++ DESFire command sequences |

`<userData>` resolves to:
- **Windows**: `%APPDATA%\SecurePass`
- **macOS**: `~/Library/Application Support/SecurePass`
- **Linux**: `~/.config/SecurePass`
