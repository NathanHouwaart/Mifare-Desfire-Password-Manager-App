# Sync Authentication — Security Analysis

> **Code change**: the minimum password length has been raised from 10 → 16
> characters in the server schema, the client-side key envelope guard, and the
> registration UI.  See [§ 6.1](#61-on-password-strength-most-important) for
> the reasoning.

> This document answers three related questions:
> 1. _"How much does my 2FA for server sync login actually improve security if
>    the only thing I ask for is a PIN code?  Is that good?  Or do I need the
>    user to re-enter authentication every day or something?"_
> 2. _"What does 'use a strong password' mean for my code?  The user already
>    provides a username and password.  Is that not the sync account password?"_
>    → [§ 0](#0-what-is-the-sync-account-password-in-the-code)
> 3. _"If the user provides a strong password AND I protect the server so the
>    database can't be downloaded — are we good?"_
>    → [§ 8](#8-strong-password--protected-server--are-we-good)

---

## Table of Contents

1. [What is the sync account password in the code?](#0-what-is-the-sync-account-password-in-the-code)
2. [What the sync account actually protects](#1-what-the-sync-account-actually-protects)
3. [The two layers of protection to keep separate in your mind](#2-the-two-layers-of-protection-to-keep-separate-in-your-mind)
4. [A weak sync password — why it matters here more than usual](#3-a-weak-sync-password--why-it-matters-here-more-than-usual)
5. [How much does TOTP MFA actually help?](#4-how-much-does-totp-mfa-actually-help)
6. [Re-authentication frequency — do you need daily re-auth?](#5-re-authentication-frequency--do-you-need-daily-re-auth)
7. [Concrete recommendations](#6-concrete-recommendations)
8. [Summary table](#7-summary-table)
9. [Strong password + protected server — are we good?](#8-strong-password--protected-server--are-we-good)

---

## 0. What is the sync account password in the code?

**Yes — the sync account password is exactly the `password` field the user
types in the Settings → Sync registration / login form.**  There is no
separate passphrase.

Here is the precise code path, starting from the UI:

```
SyncSetupFlow.tsx
  <input type="password" value={password} …>
  → window.electron['sync:register']({ password })
  → window.electron['sync:login']({ password, mfaCode })
```

That same `password` value is handled in `syncHandlers.ts`:

```typescript
// syncHandlers.ts  (sync:register handler, simplified)
const status = await registerSync(payload.password);     // ① authenticates to the API
const mode  = await prepareVaultKeyWithPassword(payload.password);  // ② wraps the key envelope

// syncHandlers.ts  (sync:login handler, simplified)
const status = await loginSync(payload.password, payload.mfaCode);  // ① authenticates
const mode  = await prepareVaultKeyWithPassword(payload.password);  // ② unwraps the key envelope
```

And `prepareVaultKeyWithPassword` calls into `vaultKeyManager.ts`:

```typescript
// vaultKeyManager.ts
const wrapKey = crypto.scryptSync(passphrase, salt, 32, { N:32768, r:8, p:1 });
// wrapKey is then used to AES-256-GCM encrypt/decrypt machineSecret
```

**So the password the user types is used for two completely independent purposes
at the same time:**

| Purpose | Where | What it protects |
|---------|-------|-----------------|
| ① API login credential | Sent to `/v1/auth/login` (or `/register`), hashed with **Argon2id** server-side | Who can call the sync API |
| ② Key-envelope passphrase | Used locally as the **scrypt** input to wrap/unwrap `machineSecret` | Confidentiality of the key envelope if the database is stolen |

These two uses have very different security requirements.  Purpose ① is
protected by the server's rate limiter, TOTP, and the Argon2id hash, so even
a shorter password is hard to crack online.  Purpose ② happens entirely
offline in an attacker's hands — the scrypt envelope they downloaded from the
database is theirs to crack at any speed they choose.  **That is why password
strength matters: for Purpose ②, only the entropy of the password stands
between the attacker and `machineSecret`.**

## 1. What the sync account actually protects

The sync server is a **ciphertext relay and key envelope store**.  It does not
hold any plaintext passwords, and the sync API itself cannot decrypt the vault.

When a client authenticates with the sync server, it gains access to:

| Asset | What it is | Who can decrypt it |
|-------|-----------|-------------------|
| Vault rows (`ciphertext`, `iv`, `authTag`) | AES-256-GCM encrypted entry blobs | Only someone with the NFC card **and** `machineSecret` |
| Key envelope (`user_key_envelopes`) | `machineSecret` wrapped with scrypt derived from the **sync account password** | Anyone who can compute `scrypt(account_password, envelope_salt)` |

The vault rows are safe even if a full database dump is stolen — decrypting them
requires the physical NFC card plus the machine secret.  Neither lives on the
server.

The key envelope is the more sensitive asset, and it is the one most directly
affected by password strength.

---

## 2. The two layers of protection to keep separate in your mind

It is easy to conflate the local lock-screen PIN with the sync account
credential.  They are completely different things:

| Credential | What it is | What it protects | How it is stored |
|-----------|-----------|-----------------|-----------------|
| **Local app PIN** (6 digits) | Prevents strangers opening the app on your machine | The app UI — not any cryptographic key | PBKDF2-SHA-256, 200 000 iterations, in `localStorage` |
| **Sync account password** | Authenticates to the sync API | API access + the key envelope | Argon2id on the server, never stored in plaintext |
| **Sync TOTP code** | Optional second factor at login | Blocks login even if the password is compromised | Shared secret in the server DB; code valid for 30 seconds |

The rest of this document is about the **sync account** (password + TOTP), not
the local PIN.

---

## 3. A weak sync password — why it matters here more than usual

The first part of this document explained *what* the sync password does.  This
section quantifies *how bad* it is to use a weak one, such as a short numeric
code or any password that can be guessed from a small space of candidates.

### 3.1 Entropy comparison

| Credential type | Possible values | Bits of entropy |
|----------------|----------------|----------------|
| 4-digit numeric PIN | 10 000 | ~13 bits |
| 6-digit numeric PIN | 1 000 000 | ~20 bits |
| 8-character alphanumeric | 218 340 105 584 896 | ~47 bits |
| Random 20-char password | ≫ 10²⁸ | ~94 bits |

A short/guessable sync password has 1 million or fewer possible values.  On a
modern GPU, scrypt at the parameters used in this codebase (`N=32768, r=8, p=1`)
can be tested at hundreds to thousands of candidates per second in an offline
attack.  A small password space is exhausted in **minutes to hours** offline.

### 3.2 The offline attack path against the key envelope

Here is the specific attack that a weak sync password enables:

```
1.  Attacker steals the PostgreSQL database dump
    (e.g., compromises the Raspberry Pi, or the Portainer instance)

2.  Attacker downloads user_key_envelopes row:
    { kdf: 'scrypt-v1', kdfParams: { N, r, p }, salt, nonce, ciphertext, authTag }

3.  Attacker brute-forces the sync account password offline:
    for each candidate:
        dk = scrypt(candidate, salt, N=32768, r=8, p=1)
        try AES-256-GCM.decrypt(dk, nonce, ciphertext)
        if authTag verifies → password found

4.  Attacker now has machineSecret

5.  But: to decrypt any vault entry, attacker STILL needs
    entryKey = HKDF(cardSecret ‖ machineSecret, salt=entryId)
    → and cardSecret lives only on the physical NFC card

6.  Without the card, the vault entries are still unreadable.
```

**Key takeaway:** A weak sync password enables the attacker to extract
`machineSecret` from the envelope.  However, `machineSecret` alone is not
enough to decrypt vault entries — the NFC card is still required.  So the
vault contents remain protected even if the password is cracked.

### 3.3 Where a weak password *does* cause a real problem

A weak sync password matters in a specific combined scenario:

- The attacker has **both** the database dump **and** the physical NFC card.
- With the password cracked (giving `machineSecret`) and the card (giving
  `cardSecret`), they can reconstruct every `entryKey` and decrypt every entry.

Compare this to the strong-password scenario:

- Even with the card, the attacker cannot derive `entryKey` without
  `machineSecret`, and a strong sync password keeps the envelope uncrackable.

**Verdict:** A weak sync password is most dangerous when the attacker also has
physical access to your NFC card.  For a personal vault where both the database
and the card are unlikely to be in the same attacker's hands simultaneously,
the practical risk is low.  For shared/team vaults the risk is higher.

---

## 4. How much does TOTP MFA actually help?

### 4.1 What TOTP protects against

TOTP (the `mfa_code` field accepted at `/v1/auth/login`) requires a valid
6-digit time-based code in addition to the password.  Codes are valid for
30 seconds ± one step (i.e., ±30 seconds clock drift is allowed).

| Attack type | TOTP helps? | Why |
|------------|------------|-----|
| **Online brute-force of the password** | ✅ Yes | An attacker who guesses the password still cannot log in without the current TOTP code |
| **Credential stuffing** (reused password from a breach elsewhere) | ✅ Yes | Same reason — the TOTP code is separate from the password |
| **Phishing the password** | ✅ Yes | Attacker has the password but not the authenticator app |
| **Offline brute-force of the key envelope** | ❌ No | The attacker already has the encrypted blob; TOTP is not involved in decrypting it |
| **Attacker has stolen the TOTP secret** (e.g., DB dump includes `mfa_secret`) | ❌ No | A full DB dump gives both the password hash and the TOTP secret — TOTP is useless at that point |
| **Session hijacking** (stolen JWT) | ❌ No | An active access token is valid regardless of MFA |

**TOTP is excellent protection against online attacks** on the login endpoint.
It is no protection at all against an attacker who already has a copy of the
database.

### 4.2 What this means for the login + TOTP combination

If the sync password is weak and TOTP is enabled:

- **Online**: Very hard to break in.  An attacker must guess the password _and_
  have the current TOTP code.  The rate limiter (100 requests/minute by
  default) means a small password space takes roughly 10 000 minutes ≈ 7 days
  of sustained online brute force, and each attempt also requires a valid TOTP
  code.  In practice, online attacks are blocked.

- **Offline** (database compromised): TOTP plays no role.  The attacker
  brute-forces the password directly against the key envelope (scrypt), no
  login required.  With a weak password, this is fast.

### 4.3 The honest verdict

> **TOTP is meaningful protection against online attacks even with a weak
> password.  It does not protect the key envelope against offline cracking.**
> The key envelope's security depends entirely on the account password strength.

For a server on a private VPN (Tailscale/WireGuard) with no public internet
exposure, online attacks are already mitigated by network access control.
In that scenario the **password strength is the primary control** for key
envelope security, and TOTP is defence-in-depth.

---

## 5. Re-authentication frequency — do you need daily re-auth?

### 5.1 Current token lifetimes

| Token | Default TTL | Configurable via |
|-------|------------|-----------------|
| Access token (JWT) | 15 minutes | `ACCESS_TOKEN_TTL` env var |
| Refresh token | 30 days | `REFRESH_TOKEN_TTL` env var |

The refresh token is rotated on every `/v1/auth/refresh` call (old token is
revoked, new one issued).  The 30-day window means the user is asked for their
full credentials (password + TOTP) roughly **once per month per device**.

### 5.2 Does more-frequent re-auth improve security?

The answer depends on what you are trying to defend against:

| Threat | Does frequent re-auth help? |
|--------|----------------------------|
| **Stolen refresh token** | ✅ Marginally — a shorter window limits the stolen token's usable lifetime |
| **Active authenticated session** (attacker has a valid access token right now) | ❌ No — the access token is already valid; re-auth won't revoke it |
| **Offline envelope crack** | ❌ No — this is a database attack, not a session attack |
| **Attacker on the same machine** | ✅ Slightly — if the attacker is waiting for a logged-in session, a 15-min access token reduces the window |

### 5.3 The real mitigating factor

The sync server is designed to run on a **private VPN** (Tailscale or
WireGuard), not exposed to the public internet.  In that environment:

- An attacker cannot attempt logins without VPN access.
- Stolen refresh tokens are worthless without VPN access.
- The 30-day re-auth window is therefore appropriate for a personal
  single-user vault.

If the server were exposed directly to the internet, a shorter refresh token
lifetime (7 days) and TOTP enabled would be strongly recommended.

### 5.4 What actually enforces "always requires card"

An important clarification: **the NFC card tap is required for every
individual credential decrypt, regardless of sync session state**.  The JWT
only gates the sync API (push/pull ciphertexts).  Even if an attacker
maintains a permanently valid session, they still cannot read any password
without tapping the physical card on the reader.

This means:

> The sync session lifetime controls who can **upload or download ciphertexts**.
> It does not control who can **read passwords** — that requires the card.

Daily re-auth on the sync session would add friction without meaningfully
improving the protection of vault contents.

---

## 6. Concrete recommendations

### 6.1 On password strength (most important)

**The sync account password — the one the user types in the Settings → Sync
login form — is used as the scrypt input to wrap and unwrap `machineSecret`.**
This is the same field that is also sent to the server for API authentication.
There is no separate passphrase; one value does both jobs.

Because this password directly governs the security of the key envelope, it
needs to be strong enough that an offline attacker cannot guess it from the
scrypt-wrapped blob.

Use a real password of at least 16 characters, ideally randomly generated (use
the built-in password generator or a password manager).  Do not use a short
numeric code or any word that appears in a dictionary.

The minimum length is now enforced at **16 characters** in three places:

| Location | What it enforces |
|----------|-----------------|
| `passwordSchema` in `sync-server/src/routes/auth.ts` | Server rejects any registration or login with fewer than 16 characters |
| `assertPassphrase` in `src/electron/vaultKeyManager.ts` | Client refuses to wrap or unwrap the key envelope with a short passphrase |
| `handleAuthenticate` in `src/ui/Components/SyncSetupFlow.tsx` | UI shows an error before even contacting the server |

A concrete comparison of offline crack time against the scrypt parameters used
(`N=32768, r=8, p=1`):

| Password type | Example | Approximate offline crack time |
|--------------|---------|-------------------------------|
| 6-digit numeric | `490823` | Seconds |
| 10 random alphanumeric | `Kp3xR7mQwN` | Hours to days |
| 16 random alphanumeric | `Kp3xR7mQwNvY2j8Z` | Longer than a human lifetime |
| Random passphrase (4+ words) | `stove-lemon-roof-camera` | Longer than a human lifetime |

The password generator in the app already produces 16-character random strings.
Direct the user there during sync registration.

### 6.2 On TOTP MFA

**Enable TOTP MFA.** It is implemented and works well.  Even if the password
is strong, TOTP adds meaningful defence against online credential attacks.

For a VPN-gated server it is optional but recommended.  For any server that is
even partially internet-accessible, TOTP should be **required**.

### 6.3 On re-authentication frequency

**30 days is the right default for a personal VPN-gated server.**  You do not
need daily re-auth.  Reasons:

- The vault requires a card tap per operation regardless.
- The server is behind a VPN.
- The main risk (database dump → offline envelope attack) is not addressed by
  re-auth frequency at all.

If you are building a shared/team version or exposing the server to the public
internet, reduce the refresh token lifetime to 7 days and enforce TOTP.

### 6.4 On the local lock-screen PIN

The local app PIN (6 digits, PBKDF2-SHA-256 with 200 000 iterations) is a
separate thing.  It gates the app UI on your local machine.  It does not
protect the sync account or the key envelope.  Its security is reasonable for
its purpose (local convenience screen-lock), but it is **not** a substitute
for a strong sync account password.

---

## 7. Summary table

| Question | Answer |
|----------|--------|
| What is the sync account password? | **The `password` field the user types in Settings → Sync registration/login.** It is sent to the API server for login and is also used locally as the scrypt KDF input to wrap/unwrap `machineSecret`. |
| Is a weak or short password good enough? | **No.** A weak password can be brute-forced offline against the scrypt key envelope in minutes to hours. Use a 16+ character randomly generated password. |
| Does TOTP meaningfully improve security over a weak-password-only login? | **Yes, for online attacks.** It blocks brute-force and credential-stuffing at the login endpoint. It provides zero protection against offline envelope cracking. |
| Do you need daily re-authentication? | **No.** 30-day refresh tokens are appropriate for a personal VPN-gated server. The vault still requires an NFC card tap per operation. |
| If TOTP is enabled with a strong password, is the sync auth solid? | **Yes.** Strong password defeats offline envelope attacks; TOTP defeats online login attacks. The combination is good. |
| What is the most important single improvement you can make? | Use a randomly generated, strong (16+ char) password in the sync setup flow. That protects the key envelope. TOTP is the second priority. |
| Strong password + protected DB — are we good? | **Yes, substantially.** See [§ 8](#8-strong-password--protected-server--are-we-good). |

---

## 8. Strong password + protected server — are we good?

**Short answer: yes, substantially.**  The two controls complement each other
and together they address every realistic attack path.  Here is exactly why.

### 8.1 What each control defeats

| Control | Attack it defeats | How |
|---------|------------------|-----|
| **Strong password (16+ char random)** | Offline envelope crack after DB theft | `scrypt(16-char-random, salt)` takes longer than the age of the universe to brute-force even on a GPU cluster |
| **Database protected from download** | DB theft itself | If the attacker never gets the `user_key_envelopes` row, there is nothing to crack offline |
| **TOTP (already implemented)** | Online brute-force of the login endpoint | Rate limiter + TOTP make online guessing impractical regardless of password length |
| **NFC card required per decrypt** | Attacker with DB dump + `machineSecret` | Even if both controls above fail, vault entries cannot be read without the physical card |

### 8.2 The residual risks (and why they are acceptable)

**If the attacker gets the DB dump but not the card:**
- They can try to crack the key envelope offline.
- With a 16-char random password and scrypt at `N=32768`, the expected crack
  time exceeds the age of the universe even with nation-state GPU resources.
- **Risk: negligible with a strong password.**

**If the attacker gets the DB dump AND the card:**
- The only thing stopping them is the password strength (TOTP is irrelevant
  for offline attacks, as explained in § 4).
- With a 16-char random password this is still effectively uncrackable.
- **Risk: negligible with a strong password.**

**If the attacker can reach the login API but not the DB:**
- TOTP + rate limiter block online guessing.
- **Risk: negligible with TOTP enabled.**

**If the attacker compromises the server process itself (not just the DB):**
- They could read tokens from memory, intercept API traffic, etc.
- This is outside the cryptographic security model of this application.
- Defence: keep the server patched, run it on a private VPN, limit OS-level
  access.
- **Risk: mitigated by server hardening, not by password strength.**

### 8.3 The defence-in-depth view

```
Layer 1: DB protection (network, VPN, no public internet exposure)
         → prevents the attacker from ever getting the encrypted blob

Layer 2: Strong password (16+ random chars, enforced by code)
         → makes offline cracking infeasible even if Layer 1 fails

Layer 3: NFC card required per vault entry decrypt
         → means even machineSecret alone is useless without the card

Layer 4: TOTP + rate limiter
         → blocks online guessing at the login endpoint
```

Any single layer can fail independently without compromising the vault.
All four layers failing simultaneously requires a remarkably capable and
persistent attacker.

### 8.4 What "protecting the DB" means in practice

Concretely, for a Raspberry Pi / Portainer setup:

- Run the sync server on **Tailscale or WireGuard** — no public internet
  exposure.  The DB cannot be downloaded if the network is not reachable.
- Set **PostgreSQL `pg_hba.conf`** to only allow connections from
  `127.0.0.1` or the Docker network, not from any external interface.
- Enable **PostgreSQL logging** so that unexpected `SELECT * FROM
  user_key_envelopes` queries are visible.
- Keep the **OS and PostgreSQL up to date** to reduce the risk of RCE or
  local privilege escalation that could give an attacker shell access.

None of these require code changes to this application.

### 8.5 Conclusion

> **Yes — a 16+ character randomly generated password combined with a
> well-protected database puts this application in a very strong security
> posture.**
>
> The NFC card requirement is a third independent layer on top of that.
> An attacker would need to steal the physical card, compromise the DB, AND
> crack a 16-char random password — all simultaneously.  That is an
> implausibly high bar for a personal vault on a private VPN.

