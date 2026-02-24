# Password Storage Architecture Plan

**Date:** 2026-02-24  
**Branch:** `feature/password-storage`  
**Stack:** Electron + React + C++ NAPI addon (PN532 / DESFire EV2)

---

## The Core Problem: Card Memory is Tiny

A **DESFire EV2** card stores applications in EEPROM. Total usable space:

| Card variant | Usable bytes | Passwords at ~710 B/ea |
|---|---|---|
| 2K | ~1 800 B | **2** |
| 4K | ~3 800 B | **5** |
| 8K | ~7 800 B | **11** |

Even with 8K you run out quickly if data lives exclusively on the card.  
**The card is not a database.** It is a hardware secret keeper.

---

## Storage Strategy Options

### Option A — Pure On-Card (Original Design)

**All data lives on the card.**  
AID `505700` = directory; AIDs `505701–50571F` = one app per password.

```
Card  ──────────────────────────────
│  Dir App        │  PW App 0x01   │  PW App 0x02 │ ...
│  directory idx  │  cred file     │  cred file   │
└────────────────────────────────────────────────────
```

**Pros:** Fully portable, zero server or disk dependency.  
**Cons:** Capped at ~2–11 passwords depending on card size. Not practical.  
**Verdict:** ❌ Too limited for real use.

---

### Option B — Card as Decryption Key, Local Encrypted Database (Recommended)

**The card holds secrets. The data lives on disk.**

```
Card ──────────────────────────────────────────────────
│  App 0x505700   │
│  File 00: 16 B  │  ← card-secret (AES-128, encrypted comm)
└─────────────────┘

Disk ──────────────────────────────────────────────────
│  passwords.db  (SQLite)                              │
│  Table: entries (id, label, url, username,           │
│                  password_enc, totp_enc, ...)        │
│  Every blob encrypted with: AES-256-GCM              │
│  Key = HKDF(card-secret ‖ machineSecret, entryId)   │
└──────────────────────────────────────────────────────
```

**Auth flow:**
1. Tap card → read `card-secret` from File 00 (requires auth with derived key)
2. Combine with `machineSecret` (stored in OS keychain via `safeStorage`)
3. Derive per-entry AES key with HKDF
4. Decrypt only the entry the user tapped

**Why per-entry keys?** Rotating one password's key doesn't re-encrypt the whole DB.

**Pros:**
- Unlimited passwords (disk is the only limit)
- Two factors required: **card** AND **machine** — neither alone decrypts anything
- Fast UI — only the card read at tap, then everything else is CPU-only
- Easy cloud sync: upload `passwords.db` (all blobs already AES-256-GCM encrypted)
- Follows the YubiKey + KeePass model in practice

**Cons:**
- Data is not self-contained on the card
- Requires the specific machine (or the `machineSecret` exported separately)

**Verdict:** ✅ **Recommended baseline approach**

---

### Option C — Multi-Layer / Multi-App Key Splitting (Enhanced Card-Only)

**Split a master key across multiple DESFire apps. All N parts required to reconstruct it.**

```
Card ─────────────────────────────────────────────────────
│  App Layer 0  │  App Layer 1  │  App Layer 2  │  Layer 3 │
│  K0 (16 B)    │  K1 (16 B)    │  K2 (16 B)    │  K3(16B) │
└──────────────────────────────────────────────────────────

Master Key = K0 ⊕ K1 ⊕ K2 ⊕ K3       (or HKDF chain of all four)
```

Each app uses a different auth key (derived independently). An attacker who dumps one app with a glitched reader still has 0 bits of the master key (XOR = 0 bits revealed per partial share).

This is a **key hardening** technique, not a storage expansion. It can be combined with Option B:

```
masterSecret = K0 ⊕ K1 ⊕ K2 ⊕ K3   (4 DESFire apps, 4 × 16 B = 64 B card use)
disk DB encrypted with HKDF(masterSecret ‖ machineSecret)
```

**Pros:**
- Reading any single app is useless — full card presence required
- Extremely tamper-resistant (Shamir-lite without the complexity)
- Still works as a key to unlock an unlimited disk DB

**Cons:**
- 4 NFC round-trips to auth each app on tap
- Slightly more complex to implement
- On the PN532 over UART the latency is noticeable (~200–400 ms total)

**Verdict:** ✅ Optional upgrade to Option B — hardening, not storage

---

### Option D — Card + Cloud Vault

**Card holds master key. Cloud stores the encrypted vault.**

```
Card ─────────── masterKey ──────────────────────────────
                                   ↓ decrypt
Cloud ──── vault.enc (AES-256-GCM) ←────── sync ───── disk cache
```

Like 1Password's "Secret Key" model (their 34-char key = hardware attestation).

**Pros:** Roaming across devices, backup handled  
**Cons:** Requires a server, out of scope for a self-hosted tool  
**Verdict:** Future enhancement once Option B is stable.

---

## Recommended Architecture: Option B + Optional C Hardening

### Card Layout (minimal, fast)

```
PICC AID 000000
└── App AID 505700  (1 key: App Master)
    └── File 00: 32 bytes (backup data, encrypted comm)
        Bytes 0–15:  card_secret     (16 B, AES-128)
        Bytes 16–31: card_uid_echo   (7 B UID + 9 B reserved, for verification)
```

Total card usage: **~200 bytes** for the whole password system.  
The rest of the card is free for future features (OTP, SSH key, etc.).

If Option C hardening is added later, split into Apps `505700–505703`, each holding 16 bytes.

### Local Database (SQLite via `better-sqlite3`)

```sql
CREATE TABLE entries (
    id          TEXT PRIMARY KEY,     -- UUID v4
    label       TEXT NOT NULL,        -- plaintext (for list view)
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    ciphertext  BLOB NOT NULL,        -- AES-256-GCM encrypted payload
    iv          BLOB NOT NULL,        -- 12-byte GCM nonce
    tag         BLOB NOT NULL         -- 16-byte GCM auth tag
);
```

`label` is stored in plaintext so the list view renders without card present.  
Everything else (url, username, password, TOTP) is in `ciphertext`.

> If label privacy is needed: store a hashed label for lookup and a dummy "Locked" display,  
> then reveal the real label on card tap.

### Key Derivation (Node.js `crypto`, main process only)

```ts
// On every card tap
const cardSecret = await nfcBinding.readCardSecret();         // 16 bytes from card
const machineSecret = safeStorage.decryptString(storedBlob);  // from OS keychain

// Per-entry encryption key
function entryKey(cardSecret: Buffer, machineSecret: string, entryId: string): Buffer {
    return crypto.hkdfSync(
        'sha256',
        Buffer.concat([Buffer.from(cardSecret), Buffer.from(machineSecret)]),
        Buffer.from(entryId, 'utf8'),  // salt = entry UUID
        Buffer.from('pwmgr-entry-v1'), // info
        32                              // 256-bit output
    );
}
```

Neither `cardSecret` nor `machineSecret` alone produces a usable key.

### Session Model

```
Tap card ──► auth DESFire ──► read cardSecret (16 B)
                                 │
                          held in memory for session duration
                                 │
                  ┌──────────────┼──────────────┐
                  ▼              ▼              ▼
            Decrypt entry A  Decrypt entry B  (on demand)
                  │
            Card removed / app locked ──► zeroize cardSecret from memory
```

The `cardSecret` lives **only in the main process memory** during the session.  
It is **never** sent to the renderer (preload exposes only already-decrypted field values).

---

## Implementation Phases

### Phase 1 — Card Page & Card Init
- New React page: `CardPage.tsx`
- Operations: `freeMemory`, `getVersion`, `getRealCardUid`, `formatPicc`, `getApplicationIds`
- "Initialise card" action: set PICC master key, create App `505700`, create File 00, write `card_secret`
- `machineSecret` generation & storage via `safeStorage`

### Phase 2 — Session Management
- `cardSecret` lifecycle: tap → read → hold → card removed → zero
- IPC: `nfc:cardTapped`, `nfc:cardRemoved`, `nfc:sessionReady`
- React context: `SessionContext` (locked | unlocked, exposing decrypt capability)

### Phase 3 — Password List
- `EntryListPage.tsx`: reads `label` + `updated_at` from SQLite (no card needed)
- Shows lock icon overlay when session not active

### Phase 4 — Create / Read Entry
- `EntryDetailPage.tsx`: decrypts `ciphertext` on demand using session key
- `CreateEntryPage.tsx`: encrypt → insert into SQLite

### Phase 5 — Edit / Delete
- In-place re-encryption on edit (new IV + tag each time)
- Soft-delete (`deleted_at`) or hard-delete with vacuum

### Phase 6 — Option C Hardening (Optional)
- Migrate single `505700` app to 4-app XOR split
- Add migration wizard in Card Page

---

## Open Questions

1. **Label privacy?** Store label plaintext (convenient) or encrypted (private but needs card for list)?
2. **Multiple machines?** Export `machineSecret` QR code or keep single-device?
3. **DB location?** `app.getPath('userData')` (default) or user-chosen path?
4. **Card re-init?** What happens if a user taps a new/blank card — auto-init or explicit wizard?
5. **Backup?** Encrypted DB export (all ciphertexts already secure, just copy the file)?
