# Card Recovery — Options and Trade-offs

> **Status: decision pending** — no code has been changed.  
> This document analyses the options your father raised and gives a concrete
> recommendation so you can decide before anything is built.

---

## The problem

If a user **loses their NFC card**, they cannot authenticate to the DESFire
application, which means `cardSecret` can never be read, which means
`entryKey = HKDF(cardSecret ‖ machineSecret, …)` can never be derived, which
means every ciphertext in the vault is **permanently unreadable**.

The current vault-export backup does not help here: it exports the encrypted
ciphertext rows, but you still need the card to decrypt them (see
[§11.3 of SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md#113-portability-constraints)).

Three recovery strategies have been raised. Each is analysed below.

---

## Option A — "Backdoor" (bypass the card requirement)

The idea is to add an alternative unlock path that works without the NFC card
at all — for example, a master passphrase or a recovery code that is accepted
instead of a card tap.

### Why the architecture makes this hard

The card is not just an authentication token; it is a **key-material source**.
The 16-byte `cardSecret` stored on the card is an indispensable input to every
`entryKey` derivation.  To unlock the vault without the card you would need to
obtain `cardSecret` from somewhere else.  The only options are:

| Where to store the fallback `cardSecret` | What it means in practice |
|------------------------------------------|--------------------------|
| Plain on disk | Machine compromise = vault compromise (same as no card at all) |
| Encrypted with a recovery passphrase on disk | Better, but the passphrase + machine together now unlock everything; the physical card is no longer required |
| Encrypted with a recovery passphrase in a cloud service | Same as above, plus you are trusting a third party |
| Encrypted with a hardware key (e.g. a YubiKey) | This replaces one piece of hardware with another — not a "backdoor", just a different second factor |

### The verdict

Any option that lets you recover without the card **necessarily stores a copy
of `cardSecret`** somewhere outside the card.  That is not inherently wrong, but
it does mean the fundamental security guarantee changes from:

> _"Attacker must have the physical card AND the machine to read any password"_

to:

> _"Attacker must have [the recovery credential] AND the machine to read any password"_

Whether that trade-off is acceptable depends on your threat model.  If the main
concern is **convenience** (not losing access) rather than defending against a
targeted attacker who has the machine, a passphrase-protected recovery key is a
reasonable choice.

**Bottom line:** a "backdoor" is not inherently insecure, but it does weaken
the two-factor guarantee.  It should be designed explicitly as a recovery path,
not hidden — and the stored recovery blob must itself be strongly protected (a
strong passphrase + PBKDF2/scrypt/Argon2, not a PIN).

---

## Option B — Authenticator app (TOTP) as a second factor

The idea is to let a TOTP code (Google Authenticator / Aegis / etc.) substitute
for the NFC card tap.

### Why TOTP cannot replace the card cryptographically

TOTP provides **authentication** (proving you know a secret at this moment in
time) but it does not provide **decryption key material**.

A 6-digit TOTP code has only ~20 bits of entropy and is valid for 30 seconds.
You cannot use it as an AES key.  What you _could_ do is:

1. Store an encrypted copy of `cardSecret` on disk.
2. Gate decryption of that copy with a successful TOTP check.
3. Use the recovered `cardSecret` to derive entry keys as normal.

But step 2 means: if an attacker dumps the disk and knows (or brute-forces) the
TOTP secret, they have everything.  This is essentially **Option A with TOTP as
the passphrase**.  It inherits all the same trade-offs — and is arguably
_weaker_ than a strong passphrase because TOTP secrets are often backed up to a
phone that may be less secure than a dedicated recovery passphrase stored
offline.

**Bottom line:** TOTP cannot cryptographically replace the NFC card.  It could
act as a _gating_ mechanism in front of a stored recovery copy of `cardSecret`,
but that is just Option A with an extra step.  It does not add meaningful
security over a well-chosen passphrase and complicates the UX significantly.
This option is **not recommended** as a card-loss recovery mechanism.

---

## Option C — Backup card (the architecturally correct solution)

The idea is to **initialise a second DESFire card at setup time**, writing the
same `cardSecret` to it, so either card can unlock the vault.

### How it works with the current key-derivation design

| Property | Card A (primary) | Card B (backup) |
|----------|-----------------|----------------|
| `cardSecret` | Same 16-byte value on both cards | Same 16-byte value on both cards |
| `appMasterKey` | `HKDF(machineSecret ‖ UID_A, …)` | `HKDF(machineSecret ‖ UID_B, …)` |
| `readKey` | `HKDF(machineSecret ‖ UID_A, …)` | `HKDF(machineSecret ‖ UID_B, …)` |
| `entryKey` (any entry) | `HKDF(cardSecret ‖ machineSecret, salt=id)` | **identical** — same `cardSecret` |

Because `cardSecret` is the same on both cards, and `entryKey` is derived from
`cardSecret + machineSecret` (not from the card UID), **any entry encrypted
with Card A can be decrypted with Card B**.

The card keys (`appMasterKey`, `readKey`) are different on each card because
the UID is mixed into their derivation.  This is intentional: the two cards
are independent hardware tokens; compromising Card A's application keys does
not compromise Card B.

### The recovery flow when Card A is lost

```
1. Tap Card B on the reader
2. App derives readKey_B = HKDF(machineSecret ‖ UID_B, …)
3. App authenticates to Card B with readKey_B
4. App reads cardSecret from Card B's File 00  ← same 16 bytes as Card A
5. entryKey = HKDF(cardSecret ‖ machineSecret, salt=entryId)  ← decrypts normally
6. (Optional) initialise a fresh Card C and write the same cardSecret to it,
   making it the new primary card
```

### What this requires at setup time

- Both cards must be **physically present** when the vault is initialised.
- The initialisation sequence runs **twice**: once for Card A, once for Card B,
  using the same random `cardSecret` but different derived keys per card.
- The backup card should be stored in a physically separate location (e.g., a
  safe, a trusted family member) — not carried alongside the primary card.

### Security properties preserved

| Property | Preserved? |
|----------|-----------|
| No `cardSecret` stored on the machine | ✅ Yes — it still lives only on hardware |
| Two-factor: physical card + machine required | ✅ Yes — you still need a card |
| Losing the machine still protects the vault | ✅ Yes |
| Card clone attack blocked | ✅ Yes — card keys are UID-bound; Card B cannot impersonate Card A |
| Single card loss = vault loss | ✅ Fixed — backup card covers this case |

**Bottom line:** the backup-card approach is the **recommended solution**.  It
solves the card-loss problem without weakening the two-factor security model,
without storing any plaintext key material on the machine, and without
introducing a new credential type (TOTP, passphrase) that could be phished or
brute-forced.

The only cost is operational: you must generate both cards at setup time, and
you must store the backup card safely.

---

## Side note: can you clone a card after the fact?

If you already have a vault set up with one card and no backup, you can still
create a backup card, provided:

1. You have the **original card** available to read `cardSecret` from.
2. You initialise a new card and write the recovered `cardSecret` to it.

The app would need a "Card Management → Add backup card" feature that:
1. Reads `cardSecret` from the existing card (one tap).
2. Initialises the new card with the same `cardSecret` (second tap).

This is feasible with the existing architecture and is the correct way to add a
backup card after the initial setup.  Implementing it does not require any
changes to how entry keys are derived or how the vault is stored.

---

## Summary and recommendation

| Option | Preserves hardware 2FA | Solves card-loss | Complexity | Recommended? |
|--------|----------------------|-----------------|------------|-------------|
| A — recovery passphrase (backdoor) | ❌ Weakens it | ✅ Yes | Medium | Only if you accept weaker guarantees |
| B — TOTP as alternative | ❌ Weakens it (same as A) | ✅ Yes (via stored copy) | High | ❌ No |
| C — backup card (setup-time) | ✅ Full | ✅ Yes | Low | ✅ **Yes** |
| C — backup card (post-setup clone) | ✅ Full | ✅ Yes (while original exists) | Medium | ✅ **Yes** |

**Your father's instinct was right**: "it overwrites the whole point of the NFC
card being needed" — that is exactly what options A and B do.  The backup-card
approach (Option C) is the standard solution used by hardware security keys
(YubiKey, FIDO2 tokens) in professional deployments: you register two keys at
setup time and store the spare securely.

The recommended implementation order when you are ready to build:

1. **Setup-time dual-card initialisation** — the simplest path; present two
   cards during first-run and initialise both with the same `cardSecret`.
2. **Post-setup "Add backup card" flow** — lets existing users add a backup
   card without starting over, as long as they still have the original card.
3. **Recovery passphrase (Option A)** — only if users specifically ask for it
   and accept the explicit trade-off disclosure.

---

## Detailed design for Option C

This section answers the follow-up questions: _when_ can a user make a backup
card, _how many_ cards can you have, and _can you clone at any time?_

---

### When can the user create a backup card?

There are **three moments** where creating a backup card makes sense, each with
different trade-offs:

#### Moment 1 — During initial vault setup (recommended)

Before the vault is initialised, `cardSecret` is generated fresh in memory and
has not yet been written anywhere.  This is the ideal moment to write it to two
(or more) cards in a single setup flow.

```
App first run
   │
   ▼
"Would you like to create a backup card now?  You can also do this later."
[Yes, set up backup card]  [Skip for now]
   │
   ▼  (if Yes)
"Tap your PRIMARY card"   ──► initialise Card A with new cardSecret + UID_A keys
   │
   ▼
"Tap your BACKUP card"    ──► initialise Card B with SAME cardSecret + UID_B keys
   │
   ▼
Both cards operational.  Store Card B somewhere safe.
```

**Why this is easiest:** `cardSecret` is a fresh random value in memory and
does not yet require a card tap to recover.  No extra DESFire round-trip is
needed to read it back from Card A before writing it to Card B.

#### Moment 2 — Any time the original card is available ("Add backup card")

After the vault is already set up, you can create a backup card at any time —
as long as you physically have the original card.  The app:

1. Taps the original card → reads `cardSecret` (same read flow as a normal
   vault unlock — `readKey` is derived from the current UID, authentication
   passes, `cardSecret` is read from File 00).
2. Taps the blank new card → runs the standard initialisation sequence, but
   uses the _recovered_ `cardSecret` instead of generating a fresh one.

There is **no time limit** on this.  You can add a backup card a year after
setting up the vault.  It is exactly equivalent to having set up two cards from
day one.

#### Moment 3 — After losing the primary card (using the backup as the source)

If the primary card is gone, the backup card _becomes_ the primary.  You can
then create a _new_ backup card from it using the same "Add backup card" flow
(tap the existing backup → read `cardSecret` → tap the new blank card →
initialise with that `cardSecret`).

---

### Can you have more than two cards?

**Yes.**  The architecture supports any number of registered cards.  All cards
share the same `cardSecret`; each card's DESFire access keys
(`appMasterKey`, `readKey`) are derived independently from its own UID, so each
card is a completely separate hardware token.

#### Practical recommendation: two cards is the right number for most people

| Number of cards | Assessment |
|-----------------|-----------|
| 1 | The current state — no recovery. If it is lost or breaks, the vault is gone. |
| **2 (primary + 1 backup)** | **The sweet spot.** Simple to manage, covers loss/damage of one card. |
| 3+ | Useful for teams or shared household accounts. More cards = more surface area if one is stolen, but the threat is low (an attacker also needs the machine). |

For a personal/single-user vault, **two cards** (one always on you, one locked
away at home or in a safe) is the standard recommendation used by every major
hardware security key vendor.

---

### What happens if a card is lost or stolen?

This is the key question.  The answers differ depending on whether the attacker
also has access to the machine.

| Scenario | Risk to vault |
|----------|--------------|
| Card A is lost, attacker does NOT have the machine | **Zero.** Card A's access keys require `machineSecret` to derive, which lives in OS secure storage.  Without the machine, Card A is useless hardware. |
| Card A is lost, attacker DOES have the machine | **High.** Attacker can derive Card A's `readKey` (because they have `machineSecret` + UID_A), read `cardSecret`, and decrypt every entry.  This is the same risk you accept on day one with any two-factor system — if both factors are compromised simultaneously, the vault is compromised. |
| Card A is stolen AND machine is compromised | Emergency: format the vault or change all passwords immediately.  Any NFC+machine combination unlocks the vault at this point. |

> If you use two cards and lose Card A, you should add a fresh backup card (from
> Card B, using Moment 3 above) as soon as possible.  That does not change any
> keys or ciphertexts — it just gives you redundancy again.

---

### Can you "revoke" a lost card?

This is a subtle point.  Revoking Card A means the app should refuse to accept
it, even though it has a valid `cardSecret`.  The current architecture has **no
revocation mechanism** — any card with the correct `cardSecret` will always
succeed in decrypting entries (via `entryKey`, which does not involve the card
UID).

If revocation becomes a requirement (e.g., shared vaults where an individual
member leaves), the right approach is to **rotate `cardSecret`**:

1. Tap any valid card → read old `cardSecret`.
2. Generate a new `cardSecret`.
3. Re-encrypt every entry with new entry keys (`HKDF(new cardSecret ‖ …)`).
4. Initialise all _trusted_ cards with the new `cardSecret`.
5. The revoked card now holds an obsolete `cardSecret` and cannot decrypt anything.

This is a significant operation (re-encrypts the entire vault) and is not
needed for the personal/single-user use case (if you lose Card A, the attacker
still does not have the machine).  It is mentioned here as a design note for
the future.

---

### Recommended UX flows (when you are ready to implement)

#### Flow 1 — Setup-time (new vault)

```
Screen: "Set up your vault"
  ├─ [New vault — tap primary card]
  │    ├─ Initialise Card A  (generate fresh cardSecret, derive UID_A keys)
  │    └─ "Would you like to add a backup card?"
  │         ├─ [Yes] → "Tap backup card" → Initialise Card B (same cardSecret, derive UID_B keys)
  │         └─ [Skip] → Done (user can add backup later via Settings)
  └─ [Existing vault — tap card to unlock]
```

#### Flow 2 — Post-setup (Settings → Card Management → Add backup card)

```
1. "Tap your CURRENT card to verify"
      │
      ▼  (reads cardSecret, same as normal vault unlock)
2. "Tap the NEW blank card"
      │
      ▼  (runs initialisation sequence with recovered cardSecret)
3. "Backup card ready.  Store it somewhere safe."
```

#### Flow 3 — Emergency replace (Lost primary, using backup)

```
1. User logs in normally with Card B (the backup — vault works fine).
2. Settings → Card Management → "Add replacement card"
3. "Tap Card B again to verify"  (reads cardSecret from backup)
4. "Tap new blank card"          (initialises with same cardSecret)
5. New card is now the primary; user has a new backup slot to fill.
```

---

### Summary answers

| Question | Answer |
|----------|--------|
| When to create a backup card? | Best: at initial setup. Also valid: any time the original card is available. |
| Multiple cards supported? | Yes — any number.  Two is the practical sweet spot. |
| Can you clone at any time? | Yes, as long as the source card is physically available. |
| Can you create a backup after losing the primary? | No — you need to read `cardSecret` from a working card first. This is why the backup must be created _before_ the primary is lost. |
| Does adding cards weaken security? | No.  Each card is an independent hardware token.  Adding a card does not change any keys or ciphertexts. |
| Can you revoke a lost card? | Not with the current design.  For personal use this is acceptable (attacker also needs the machine).  Revocation requires a full `cardSecret` rotation if needed in the future. |
