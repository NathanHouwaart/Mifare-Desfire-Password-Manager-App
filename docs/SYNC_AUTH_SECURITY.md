# Sync Authentication — Security Analysis

> **No code has been changed.** This document answers the questions:
> _"How much does my 2FA for server sync login actually improve security if the
> only thing I ask for is a PIN code?  Is that good?  Or do I need the user to
> re-enter authentication every day or something?"_

---

## Table of Contents

1. [What the sync account actually protects](#1-what-the-sync-account-actually-protects)
2. [The two layers of protection to keep separate in your mind](#2-the-two-layers-of-protection-to-keep-separate-in-your-mind)
3. [PIN as a password — why it matters here more than usual](#3-pin-as-a-password--why-it-matters-here-more-than-usual)
4. [How much does TOTP MFA actually help?](#4-how-much-does-totp-mfa-actually-help)
5. [Re-authentication frequency — do you need daily re-auth?](#5-re-authentication-frequency--do-you-need-daily-re-auth)
6. [Concrete recommendations](#6-concrete-recommendations)
7. [Summary table](#7-summary-table)

---

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

## 3. PIN as a password — why it matters here more than usual

### 3.1 Entropy comparison

| Credential type | Possible values | Bits of entropy |
|----------------|----------------|----------------|
| 4-digit numeric PIN | 10 000 | ~13 bits |
| 6-digit numeric PIN | 1 000 000 | ~20 bits |
| 8-character alphanumeric | 218 340 105 584 896 | ~47 bits |
| Random 20-char password | ≫ 10²⁸ | ~94 bits |

A 6-digit PIN has 1 million possible values.  On a modern GPU, Argon2id at
moderate parameters can be tested at thousands of candidates per second in an
offline attack.  A 6-digit PIN space is exhausted in **minutes to hours** offline.

### 3.2 The offline attack path against the key envelope

Here is the specific attack that a weak PIN enables:

```
1.  Attacker steals the PostgreSQL database dump
    (e.g., compromises the Raspberry Pi, or the Portainer instance)

2.  Attacker downloads user_key_envelopes row:
    { kdf: 'scrypt-v1', kdfParams: { N, r, p }, salt, nonce, ciphertext, authTag }

3.  Attacker brute-forces account password offline:
    for each candidate PIN:
        dk = scrypt(candidate, salt, N, r, p)
        try AES-256-GCM.decrypt(dk, nonce, ciphertext)
        if authTag verifies → password found

4.  Attacker now has machineSecret

5.  But: to decrypt any vault entry, attacker STILL needs
    entryKey = HKDF(cardSecret ‖ machineSecret, salt=entryId)
    → and cardSecret lives only on the physical NFC card

6.  Without the card, the vault entries are still unreadable.
```

**Key takeaway:** A weak PIN enables the attacker to extract `machineSecret`
from the envelope.  However, `machineSecret` alone is not enough to decrypt
vault entries — the NFC card is still required.  So the vault contents remain
protected even if the PIN is cracked.

### 3.3 Where a weak PIN *does* cause a real problem

The PIN being weak matters in a specific combined scenario:

- The attacker has **both** the database dump **and** the physical NFC card.
- With the PIN cracked (giving `machineSecret`) and the card (giving `cardSecret`),
  they can reconstruct every `entryKey` and decrypt every entry.

Compare this to the strong-password scenario:

- Even with the card, the attacker cannot derive `entryKey` without
  `machineSecret`, and a strong password keeps the envelope uncrackable.

**Verdict:** A PIN is weakest when the attacker also has physical access to
your NFC card.  For a personal vault where both the database and the card are
unlikely to be in the same attacker's hands simultaneously, the practical risk
is low.  For shared/team vaults the risk is higher.

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

### 4.2 What this means for the "PIN + TOTP" combination

If the sync account password is a PIN and TOTP is enabled:

- **Online**: Very hard to break in.  An attacker must guess the PIN _and_
  have the current TOTP code.  The rate limiter (100 requests/minute by
  default) means a 6-digit PIN takes roughly 10 000 minutes ≈ 7 days of
  sustained online brute force, and each attempt also requires a valid TOTP
  code.  In practice, online attacks are blocked.

- **Offline** (database compromised): TOTP plays no role.  The attacker
  brute-forces the PIN directly against the key envelope (scrypt), no login
  required.  With a 6-digit PIN, this is fast.

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

**Do not use a PIN as the sync account password.**  Use a real password of at
least 16 characters, ideally randomly generated.

The reason is specifically the **key envelope**: the envelope is scrypt-wrapped
with the account password.  A PIN can be cracked offline in minutes.  A random
16-character password would take longer than the age of the universe to brute
force at current GPU speeds.

The `passwordSchema` in the server already enforces a minimum of 10 characters.
If you want to be explicit, you could raise the minimum to 16 characters and
document why.

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
| Is a PIN as the sync account password good enough? | **No.** A PIN can be brute-forced offline against the scrypt key envelope in minutes. Use a 16+ character random password. |
| Does TOTP meaningfully improve security over a PIN-only login? | **Yes, for online attacks.** It blocks brute-force and credential-stuffing at the login endpoint. It provides zero protection against offline envelope cracking. |
| Do you need daily re-authentication? | **No.** 30-day refresh tokens are appropriate for a personal VPN-gated server. The vault still requires an NFC card tap per operation. |
| If TOTP is enabled with a strong password, is the sync auth solid? | **Yes.** Strong password defeats offline envelope attacks; TOTP defeats online login attacks. The combination is good. |
| What is the most important single improvement you can make? | Use a randomly generated, strong (16+ char) account password. That protects the key envelope. TOTP is the second priority. |
