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
still does not have the machine).  See the full design analysis in the
[Card Revocation](#card-revocation--design-analysis) section below.

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

---

## Card Revocation — Design Analysis

> **No code has been changed.** This section is a forward-looking design
> document explaining what revocation would require and when it is worth building.

---

### Why would you want card revocation?

Before deciding _how_ to build revocation, it is worth understanding the
scenarios that make it valuable — because for a personal single-user vault the
answer is often "you don't need it at all".

#### Scenario 1 — Personal vault, card lost but machine is safe

The attacker has Card A but not your machine.

Without the machine, they cannot derive Card A's `readKey`
(`HKDF(machineSecret ‖ UID_A, …)`), so they cannot authenticate to the
DESFire application, so they cannot read `cardSecret`, so they cannot decrypt
anything.

**Verdict: no revocation needed.** The card is useless without the machine.
Just add a replacement card from your backup (see Moment 3 in the backup-card
design above) and carry on.

#### Scenario 2 — Personal vault, card AND machine are both compromised

Both factors have been obtained.  The attacker already has everything they
need to decrypt the vault right now.  Revoking the card after the fact does
not undo the compromise — the passwords have already been readable.

**Verdict: the right response is to change all the passwords**, not to rotate
the card secret.  Revocation cannot retroactively fix a breach.

#### Scenario 3 — Shared vault (family / team)

Multiple people each hold a card that was initialised with the same
`cardSecret`.  One person leaves the team (or their card is confirmed stolen
in a situation where the machine may also be at risk).  You want to ensure that
person's card can no longer decrypt vault entries, even if they have the
machine, because the machine itself may also be shared or accessible.

**Verdict: this is the real use case for revocation.** A shared vault where
membership changes is the scenario where `cardSecret` rotation is genuinely
necessary.

#### Scenario 4 — Security hygiene / periodic rotation

Some security policies require periodic key rotation as a hygiene measure,
regardless of whether a breach has occurred.  This is standard practice for
server-side secrets (TLS certificates, API keys).  Applying it to card secrets
is unusual for a personal tool but becomes relevant in corporate or regulated
environments.

**Verdict: valid but niche.** Not needed for a personal password manager.

---

### Why revocation is hard: the shared-secret problem

The fundamental challenge is that **all cards share the same `cardSecret`**.
This is what makes the multi-card model work (any card can decrypt any entry),
but it also means you cannot revoke one card without re-keying all the others.

You cannot simply "block" Card A's UID and keep using Card B as-is.  If you
block Card A by UID but do not rotate `cardSecret`, Card B still holds the same
`cardSecret` as Card A.  If an attacker has Card A and knows the old
`cardSecret` (because they tapped it before you blocked it), they could in
theory derive `entryKey` values for older entries if they also have or had the
machine.

True revocation therefore means: **the old `cardSecret` must never be usable
again**.  The only way to achieve that is to replace every entry's ciphertext
with a new ciphertext derived from a new `cardSecret`.

---

### What would need to change — layer by layer

#### Layer 1 — Vault database (vault.db)

A new table is needed to track which cards are registered and whether each one
is trusted or revoked.  This is schema migration **v3**.

```sql
-- New table (migration v3)
CREATE TABLE registered_cards (
  uid          TEXT    PRIMARY KEY,  -- hex UID of the DESFire card
  label        TEXT    NOT NULL DEFAULT '',  -- user-given name, e.g. "Primary", "Backup safe"
  registered_at INTEGER NOT NULL,    -- Unix ms
  status       TEXT    NOT NULL DEFAULT 'trusted'
                        CHECK(status IN ('trusted', 'revoked'))
);
```

Without this table the app has no memory of which cards have ever been
registered.  Currently it accepts any card whose UID it can derive a valid
`readKey` for — there is no explicit registry.

The migration would need to be added to the existing migration runner
(`vault.ts`) alongside the existing v1→v2 migration.

#### Layer 2 — Card authentication gate (cardHandlers.ts / vaultHandlers.ts)

Today the read flow is:
```
tap card → derive readKey from UID → authenticate → read cardSecret → decrypt
```

With a revocation registry, the read flow must become:
```
tap card → check UID against registered_cards
         → if status = 'revoked': reject immediately (do not proceed)
         → if status = 'trusted':  continue as today
         → if UID not in table:    reject (unknown card — not registered)
```

This check is inexpensive (a single SQLite query) and must happen **before**
the DESFire authentication attempt.  The important consequence is that the
app would no longer accept _any_ card that happens to carry the right
`cardSecret` — only explicitly registered, non-revoked UIDs are allowed.

This is a behaviour change: today the app is UID-agnostic at the entry-key
level.  With a registry it becomes UID-aware.  Existing users who currently
have only one card would automatically be registered during the first run of
the migration (their card's UID would need to be recorded).

#### Layer 3 — cardSecret rotation operation (new IPC handler)

This is the core of revocation.  The handler (call it `card:rotateSecret`)
would perform the following steps:

```
1.  Tap a TRUSTED card
    → derive readKey, authenticate, read old cardSecret

2.  Generate new cardSecret (16 random bytes)

3.  For every entry row in vault.db:
    a.  Derive old entryKey = HKDF(old cardSecret ‖ machineSecret, salt=id)
    b.  Decrypt ciphertext → plaintext JSON
    c.  Zeroize old entryKey
    d.  Derive new entryKey = HKDF(new cardSecret ‖ machineSecret, salt=id)
    e.  Encrypt plaintext → new ciphertext, new iv, new authTag
    f.  Write new ciphertext/iv/authTag to a staging column
    g.  Zeroize new entryKey

4.  In a single SQLite transaction:
    a.  Swap staging columns → live columns for all entries
    b.  Mark the revoked card's UID as 'revoked' in registered_cards
    c.  Commit

5.  Tap each remaining TRUSTED card (one by one)
    → Re-initialise with new cardSecret (same DESFire init sequence)
    → Update registered_at timestamp in registered_cards

6.  Zeroize old cardSecret, new cardSecret from memory
```

The transaction in step 4 is critical for safety.  If the app crashes between
steps 3 and 4, the staging columns are discarded on the next run and the vault
is unharmed.  If it crashes after step 4 but before step 5, some trusted cards
still hold the old `cardSecret` and cannot decrypt the new ciphertexts — this
is a **degraded state** that would need to be detected and recovered.

#### Layer 4 — Atomicity and crash safety

The rotation touches two independent systems (the SQLite database and the
physical cards) in sequence.  SQLite can be made atomic; the card taps
cannot — they are physical operations.

This creates a window of vulnerability:
```
[SQLite committed with new ciphertexts]  ← safe point
[Card re-init tap 1 — success]
[Card re-init tap 2 — app crash or user walks away]  ← unsafe: Card 2 still has old cardSecret
```

To handle this safely, the app would need to record the rotation state:

| State | Meaning | Recovery action |
|-------|---------|----------------|
| `idle` | No rotation in progress | Normal operation |
| `rotating` | Ciphertexts replaced, some cards pending re-init | On next launch: prompt user to re-tap pending cards |
| `complete` | All trusted cards re-initialised | Cleanup, return to idle |

A lightweight approach: store the rotation state in a new `rotation_state`
row in the database (or a small JSON file in `userData`), updated atomically
alongside the ciphertext swap.  On app launch, if state is `rotating`, the
app must present a "complete card rotation" screen before allowing normal use.

#### Layer 5 — Card initialisation (C++ layer, Pn532Adapter.cc)

No changes are needed at the DESFire protocol level.  The existing
initialisation sequence (`card:init`) already accepts an arbitrary
`cardSecret` — it just generates a fresh random one today.  To re-initialise
a card during rotation, the app would call the same init sequence but pass
the _new_ `cardSecret` instead of a fresh random value.

The key step that would need to be exposed is: "run init with a given
`cardSecret`", rather than always generating one internally.  Today
`cardSecret` is generated inside the handler; the rotation flow would need to
generate it once and pass it through to each card init.  This is a small
internal refactor at the JavaScript/IPC level only — the C++ DESFire sequence
itself does not change.

#### Layer 6 — UI (renderer)

New screens required:

| Screen | Purpose |
|--------|---------|
| Card Management list | Shows all registered cards with UID (truncated), label, status, registration date |
| Revoke card | Confirmation dialog: "Revoking Card A will re-encrypt the vault and require you to re-tap all trusted cards.  This cannot be undone.  Continue?" |
| Rotation progress | Step-by-step progress: "Decrypting entries…", "Re-encrypting entries…", "Tap Card B to re-initialise", "Tap Card C to re-initialise", "Done" |
| Rotation resume | On launch when state = `rotating`: "You have a pending card rotation.  Tap your trusted cards to complete it." |

The rotation progress screen needs a progress indicator because re-encrypting
a large vault (hundreds of entries) can take several seconds.

---

### How the app changes in practice

| Behaviour today | Behaviour with revocation |
|-----------------|--------------------------|
| Any card with the right `cardSecret` is accepted | Only UIDs in `registered_cards` with status `trusted` are accepted |
| Adding a new card is invisible to the database | Each new card must be explicitly registered and gets a row in `registered_cards` |
| Losing a card has no database consequence | Losing a card triggers a revocation flow that rotates all ciphertexts |
| vault.db has 2 tables (schema_version, entries) | vault.db has 3+ tables (+ registered_cards, + rotation_state) |
| Card init generates a fresh `cardSecret` every time | Card init can accept an externally supplied `cardSecret` (for re-init during rotation) |
| No concept of "trusted vs revoked" | Every tap passes a UID check before proceeding |

---

### Should you implement it?

| Use case | Recommendation |
|----------|---------------|
| Personal vault, single user | **No.** A stolen card alone is harmless (attacker needs the machine).  The backup-card approach gives all the recovery you need without this complexity. |
| Personal vault, you are security-conscious and want periodic rotation | **Optional.** The rotation operation itself is sound; the main cost is the UI complexity and crash-safety engineering. |
| Shared household vault (2–3 trusted family members) | **Borderline.** If a card is lost and you worry the machine may eventually be accessible to the finder, rotation is a reasonable precaution. |
| Team / workplace vault (multiple people, people leave) | **Yes.** This is the scenario revocation was designed for.  Without it, an ex-team-member with their card and access to the machine can still read the vault indefinitely. |

**Bottom line for a personal vault:** you do not need revocation.  The
architecture is deliberately simple precisely because it targets the personal
use case.  If the app evolves into a team tool, revocation becomes a
first-class requirement and the design above is the correct path.
