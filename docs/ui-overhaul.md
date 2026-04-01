Let me read all the relevant files first to ground this in the actual code.  

Read [](file:///c%3A/Users/Nathan/Documents/PasswordManagerApp/src/ui/App.tsx#1-1), lines 1 to 260

Read [](file:///c%3A/Users/Nathan/Documents/PasswordManagerApp/src/ui/Components/LockScreen.tsx#1-1), lines 1 to 120

Read [](file:///c%3A/Users/Nathan/Documents/PasswordManagerApp/src/ui/Components/LockScreen.tsx#120-120), lines 120 to 271

Read [](file:///c%3A/Users/Nathan/Documents/PasswordManagerApp/src/ui/pages/SettingsPage.tsx#1-1), lines 1 to 200

Read [](file:///c%3A/Users/Nathan/Documents/PasswordManagerApp/src/ui/pages/SettingsPage.tsx#560-560), lines 560 to 580

Read [](file:///c%3A/Users/Nathan/Documents/PasswordManagerApp/src/ui/Components/OnboardingScreen.tsx#90-90), lines 90 to 160

Now I have a comprehensive picture of the codebase. Here is the full audit.

---

# SecurePass — UX/UI Audit & Redesign Proposal

---

## Section A: Top Problems (Prioritized)

### P0 — Will cause user failure or data loss

**A-01 · PIN setup is frictionless in the wrong direction**
LockScreen.tsx creates a PIN on first launch with zero context. A non-technical user who doesn't understand what the PIN protects will enter "123456" or dismiss it by confusion. There is no explanation that this PIN is the *only thing* standing between a thief and all their passwords. The confirmation phase error message — "PINs do not match - try again" — resets to phase 1 silently.

**A-02 · "Sync" and "Vault" passwords are never distinguished for users**
The onboarding wizard uses the label "Password for your sync account" and separately "Vault key passphrase" in consecutive steps, but never explains that *these are two different things that should be different*. A first-time user who uses the same password for both has reduced their security drastically without knowing it. The copy says nothing about why two exist.

**A-03 · No feedback when first-run onboarding is abandoned mid-way**
If the user closes the window during sync setup (between "Create Account" succeeding and "Vault Key" being created), they re-open to a partially configured state. `computeSyncedStep` in OnboardingScreen.tsx resumes from the right step, but the user has no idea where they are or what happened. There is no "Resume setup" banner anywhere in the main app.

**A-04 · Vault key passphrase is silently skipped on first run**
`vaultPassword` defaults to `''` and `vaultAutoAttempted` logic could allow bypassing this step. If the vault passphrase is blank, the vault key is weakly encrypted. There is no strength indicator or minimum length enforcement visible in the UI.

---

### P1 — Will cause frequent confusion or support calls

**A-05 · "Local" vs "Synced" framing is technically correct but cognitively wrong**
"Sync" implies a feature you toggle on, not a fundamentally different security model. A non-technical parent thinks: "I don't need sync, I'll skip that." They don't realize local-only means losing everything if the computer dies. The choice is architecturally one-way (local → synced is fine; synced → local requires manual vault migration) but the UI presents it as reversible.

**A-06 · Three places to manage sync (Settings → Sync, Sidebar → Sync button, OnboardingScreen)**
These three surfaces partially duplicate each other. Settings has "Open Sync Wizard" which opens `OnboardingScreen` via a custom event. The Sidebar Sync button also opens `OnboardingScreen`. But Settings also has its own inline sync controls (logout, sync now, advanced). A confused user can be in two of these at once.

**A-07 · The lock screen has no "forgot PIN" path**
LockScreen.tsx has no escape route. If a user forgets their PIN on a first-time setup (e.g., the confirmation fires before they're sure), they are locked out permanently with no visible exit. The only path is a manual `localStorage` wipe, which a non-technical user cannot do.

**A-08 · "First time on this server" vs "I already have an account" requires knowing what "this server" means**
A user's mental model is "Nathan set up a server." They don't think of themselves as having an account "on a server." The tile copy makes this distinction load-bearing but doesn't define terms.

**A-09 · SettingsPage sync section exists in parallel with the wizard**
SettingsPage.tsx has its own inline forms for sync URL, username, auth, MFA, vault key status, logout, and reset — all independent of `OnboardingScreen`. This creates two separate sync UIs that can get out of sync with each other (e.g., logout in one doesn't immediately reflect in the other unless status is re-polled). It also means the "Open Sync Wizard" button in Settings is redundant with the Sidebar button.

**A-10 · The NFC requirement is invisible until it blocks the user**
Nowhere in onboarding is it explained that an NFC card is required to *use* any credential. A user will set up their vault, add a password, click "Reveal" — and hit a wall. The NFC card is introduced only in `NfcReaderPage` and the Sidebar status dot, never during setup.

---

### P2 — Friction, inconsistency, or polish issues

**A-11 · Autolock default is 5 minutes; PIN wake is false by default**
These defaults are inverted from a security app. Should be PIN-on-wake enabled by default, autolock at 5 minutes max.

**A-12 · Debug Terminal is shown to all users**
`terminalEnabled` defaults to `'true'`. A non-technical user sees a debug console in their navigation. It should default to `false` or be removed from normal navigation entirely.

**A-13 · "NFC Reader" is a nav item alongside Passwords and Generator**
This is a hardware diagnostic screen, not a user-facing feature. It should be in Settings, not top-level navigation.

**A-14 · "Sync Now" button in Settings has no visible last-sync time near it**
The last sync time is shown elsewhere in the section, not adjacent to the button. Users click "Sync Now" and don't know if it worked.

**A-15 · Vault passphrase field labeled "Vault key passphrase" in OnboardingScreen but "Vault Passphrase" in SettingsPage**
Inconsistent terminology for the same concept.

**A-16 · `handleChangePIN` uses `alert()` native dialog**
A jarring OS-level dialog inside a styled app.

**A-17 · No keyboard trap when modal is open**
The sync modal renders `OnboardingScreen` as a modal overlay but focus is not trapped inside it. Tab will reach Sidebar and main content behind the backdrop.

**A-18 · Backdrop click closes sync modal but Esc key does not**
Standard modal behavior requires both. Only `onClick` on the outer div handles closing.

**A-19 · Color-only status indicators throughout**
The Sidebar sync dot, NFC dot, and vault key status badges use color as the only differentiator. Fails WCAG 1.4.1 (Use of Color).

---

## Section B: New Information Architecture + Mental Model

### Two modes, one vault

The core mental model to communicate:

> **Your vault lives on this computer. Syncing lets it also live on other computers.**

This reframes "synced" not as a different product but as an optional backup/multi-device layer. The vault always exists locally; syncing just keeps copies elsewhere.

### Concept glossary (plain-language)

| Technical term | Plain-language equivalent | Where to use it |
|---|---|---|
| Local mode | "This device only" | Onboarding, Settings |
| Synced mode | "Backed up and shared" | Onboarding, Settings |
| Vault passphrase | "Your secret key" | Onboarding, first use, any passphrase prompt |
| Sync account password | "Your server sign-in password" | Onboarding account step only |
| PIN | "Your unlock PIN" | Lock screen, Settings |
| NFC card | "Your NFC card" (no jargon needed) | Onboarding, Passwords page |
| 2FA / MFA | "Extra security code from your phone" | MFA step |

### Five user intentions and their correct home

| User wants to… | Where it should live | Current state |
|---|---|---|
| Unlock the vault | Lock screen | ✅ Correct |
| Set up sync for the first time | Sidebar Sync button → wizard | ✅ (now) |
| Log out of sync account (this device only) | Sync modal → "Sign out on this device" | ⚠️ Buried in Settings advanced |
| Switch to a different sync account on this device | Sync modal → "Use a different account" | ❌ Not clearly surfaced |
| Stop syncing and go back to local | Sync modal → "Stop syncing" | ❌ Not clearly surfaced |
| Wipe everything and start fresh | Settings → Danger Zone (hidden by default) | ❌ In sync advanced section |

---

## Section C: New User Flows (Step-by-Step)

### Flow 1 — First run (new user)

```
Splash (2s)
  └─ Onboarding: "Welcome to SecurePass"
       ├─ Step 1: Choose how to use it
       │     [Keep it on this device]  ← recommended for new users
       │     [Back up & use on multiple devices]
       │
       ├─ If LOCAL:
       │     Step 2: Set up your unlock PIN
       │       → Explain: "This PIN unlocks the app. Without it, no one can open SecurePass."
       │       → PIN entry + confirm
       │       → DONE: "You're set up! Your passwords stay only on this computer."
       │         ↳ First-time hint banner: "Tap the NFC card icon next to any password to use it"
       │
       └─ If SYNCED:
             (existing 5-step wizard — see current OnboardingScreen)
             After wizard done:
             → Set up PIN (same Step 2 as local)
             → DONE: "You're set up and your vault is backed up."
```

**Key change:** PIN setup moves to onboarding, before user reaches the vault, so it never catches them off-guard at the lock screen.

---

### Flow 2 — Returning local user

```
App opens → LockScreen
  → Enter PIN → unlock animation → Passwords page
  → NFC status shown in sidebar
```
No change needed except: if `requirePinWake` is `false` and `autolock` is `never`, the vault opens immediately — this should prompt a one-time "Enable auto-lock?" nudge.

---

### Flow 3 — Returning synced user

```
App opens → LockScreen
  → Enter PIN → unlock animation
  → App auto-syncs (already implemented)
  → Sidebar Sync button: CloudCheck green ✓
```
If sync fails on unlock, the sidebar shows CloudAlert amber. Clicking it opens the Sync modal showing "Last sync error: [message]" with a "Try again" CTA — not a buried Settings item.

---

### Flow 4 — Switch from local → synced

```
Sidebar: click Sync (CloudOff) → Modal opens
  → "You're currently storing passwords on this device only."
  → [Back up and sync to another device] CTA
  → Runs existing 5-step wizard (configure → account → mfa → vault → done)
  → On complete: localStorage set-sync-mode = 'synced'
```

---

### Flow 5 — Stop syncing (synced → local)

```
Sidebar: click Sync (CloudCheck or CloudAlert) → Modal opens
  → Shows current status: "Backed up to http://… as username"
  → [Stop syncing on this device]
    → Confirmation: "Your passwords will stay on this device. 
       The backup on the server is not deleted."
    → Calls sync:clearConfig, sets mode='local'
```

---

### Flow 6 — New person logging into same desktop

```
Sidebar: click Sync → Modal opens
  → "Already signed in as [username]"
  → [Sign out and use a different account]
    → Confirmation: "This removes [username]'s sync session from this computer.
       Their passwords are not deleted from this device or the server."
    → Logout → returns to configure step (new username/URL)
```

---

## Section D: Copy Deck (Exact Text)

### Onboarding

**Welcome screen headline:** "Welcome to SecurePass"  
**Welcome screen subhead:** "Let's get your passwords set up. This takes about 2 minutes."

**Mode choice — local tile:**  
Title: "Just this computer"  
Body: "Your passwords stay on this device only. Simple and offline. You can always add backup later."

**Mode choice — synced tile:**  
Title: "Back up and sync"  
Body: "Keep your passwords safe even if this computer breaks. Use them on other devices too. Needs a sync server."

**Configure step headline:** "Connect to your sync server"  
**Configure step helper (server field):** "Whoever set up the server can give you this address."  
**Configure step helper (username):** "Use the same username on every device — e.g. 'dad' or 'nathan'."

**Account mode — choose:**  
"First time? → Create a new account"  
"Used this server before? → Sign in"

**Register headline:** "Create your account"  
**Register password label:** "Choose a sign-in password"  
**Register password hint:** "This gets you into the sync server. It's not the same as your vault key."

**MFA headline:** "Add extra protection (recommended)"  
**MFA pre-setup body:** "This stops anyone else signing into your sync account even if they know your password. You'll need a free app on your phone."

**Vault passphrase headline:** "Set your secret key"  
**Vault passphrase body (first time):** "This key encrypts your passwords before they leave this device. The server never sees it. Write it down and keep it safe — without it, your passwords can't be recovered."  
**Vault passphrase body (returning):** "Enter the secret key you set when you first added sync."  
**Vault passphrase warning:** "⚠ Store this somewhere safe — a notebook, not your phone. You need it every time you set up a new device."

**Done headline:** "You're all set!"  
**Done body:** "Your vault is set up and backed up. On your next device, tap 'Sign in' with the same username."

---

### Lock screen

**Setting PIN — enter:** "Create your unlock PIN"  
**Setting PIN — subhead:** "Choose 6 digits that only you know. This unlocks SecurePass."  
**Setting PIN — confirm:** "Re-enter your PIN to confirm"  
**Wrong PIN:** "Incorrect PIN — try again"  
**PINs don't match:** "Those didn't match — start again"

**Forgot PIN link text:** "Forgot your PIN?"  
**Forgot PIN dialog:** "To reset your PIN, you'll need to re-enter your vault passphrase. This does not affect your saved passwords."

---

### Sync modal (when already set up)

**Signed-in status banner:** "Synced as [username] · [server]"  
**Last synced:** "Last synced just now" / "Last synced 3 hours ago" / "Never synced"  
**Sync error banner:** "Sync error: [message] — [Try again]"  

**Stop syncing CTA:** "Stop syncing on this device"  
**Stop syncing confirmation:** "This removes the sync connection from this device. Your passwords stay here and on the server — nothing is deleted."  

**Sign out CTA:** "Sign out on this device"  
**Sign out confirmation:** "You'll need to sign in again to sync. Your passwords stay on this device."

**Switch user CTA:** "Use a different account"

---

### Settings page

**Sync section title:** "Backup & Sync"  (not "Sync")  
**Mode label — local:** "This device only"  
**Mode label — synced:** "Backed up & synced"  

**PIN section:** "Unlock PIN"  
**Change PIN button:** "Change PIN"  
**Change PIN confirmation (replace `alert()`):** inline success message "PIN reset. You'll set a new one when you next lock the vault."

**Danger zone section title:** "Danger Zone"  
**Reset vault button:** "Erase everything and start over"  
**Reset vault confirmation:** "This permanently deletes all passwords from this device. The backup on the server (if any) is not affected."

---

## Section E: Implementation Plan (by File)

### Phase 1 — Zero-risk copy & label fixes (1–2 days)

| File | Change |
|---|---|
| OnboardingScreen.tsx | Apply copy deck: all headings, labels, placeholder text, error messages |
| LockScreen.tsx | Apply copy deck; add "Forgot your PIN?" link that calls `handleForgotPin` |
| SettingsPage.tsx | Rename "Sync" section to "Backup & Sync"; replace `alert()` in `handleChangePIN` with inline feedback |
| Sidebar.tsx | Add `aria-label` to all icon buttons; add text label alongside status icons (not just color) |

---

### Phase 2 — Navigation & information architecture (2–3 days)

| File | Change |
|---|---|
| Sidebar.tsx | Move "NFC Reader" out of top nav into Settings; remove DebugTerminal from nav entirely; set `terminalEnabled` default to `false` |
| App.tsx | Add `Esc` keydown handler to close sync modal; add focus trap (`autoFocus` on first input, `Tab` cycles within modal) |
| SettingsPage.tsx | Collapse full inline sync forms behind a single "Open Sync Settings" CTA that opens the modal — duplicate surface eliminated; keep only "Sync Now" + last sync time + status inline |

---

### Phase 3 — Onboarding PIN integration (2–3 days)

The primary structural change — move PIN setup into onboarding so it runs before first vault access.

**App.tsx:**
```
needsOnboarding === true
  → OnboardingScreen → onComplete(mode)
    → if !localStorage.getItem(PIN_HASH_KEY)
        → PinSetupScreen (new inline component or LockScreen isSettingPin=true)
      → then setNeedsOnboarding(false)
```

**LockScreen.tsx:**
- Extract `PinSetup` into its own standalone component so it can be used in onboarding flow independently
- Add `onForgotPin?: () => void` prop; show "Forgot your PIN?" link at bottom when prop is provided
- `handleForgotPin` calls `window.electron['vault:verifyPassphrase']` (new or existing) then clears the hash

---

### Phase 4 — Accessibility hardening (2 days)

| Area | Change |
|---|---|
| Focus trap in modals | Add `useFocusTrap` hook called in App.tsx when `showSyncModal === true` |
| `Esc` to close modal | Add `useEffect` listening for `Escape` setting `showSyncModal(false)` |
| ARIA roles | `OnboardingScreen`: add `role="dialog" aria-modal="true" aria-labelledby="onboarding-title"`; `LockScreen`: add `role="main"` |
| Color + icon pairing | All status indicators (sync dot, NFC dot) add a visible text label or `aria-label` — never rely on color alone |
| Keyboard order | Verify `tabIndex` order in PIN keypad is numeric `1→9, 0, ⌫`; currently grid layout is correct but verify with logical DOM order |
| Contrast | `text-dim` (#71717a) on `bg-card` (#27272a) = ~4.5:1 ✅; `text-lo` on `bg-page` — audit with exact token values |

---

### Phase 5 — Sync UX stabilization (3–4 days)

| File | Change |
|---|---|
| App.tsx | Expose `syncError` state derived from `syncStatus.lastSyncError`; pass to `Sidebar` for amber alert |
| Sidebar.tsx | When `CloudAlert`: show inline tooltip/popover on hover with last error and "Open sync settings" link |
| OnboardingScreen.tsx | Add "Stop syncing on this device" and "Use a different account" flows as new branches off the already-synced state; currently the only path when logged in is to proceed forward |
| SettingsPage.tsx | Move full sync advanced controls (URL, username, logout, clear, MFA management) into the sync modal; keep Settings sync section to status summary + "Open Sync Settings" only |

---

### Phase 6 — Non-technical parent polish (1–2 days)

| Item | Change |
|---|---|
| Remove "NFC Reader" from nav | Move to Settings → Hardware section |
| Default `terminalEnabled` to `false` | Change `localStorage` init |
| Add "What's NFC?" tooltip | First time a user adds a credential, show a one-time tooltip: "You'll use your NFC card to unlock each password when you need it." |
| Default `requirePinWake` to `true` | Change default in SettingsPage init |
| Autolock default to 5 min | Already 5 min; confirm `'never'` is not the default |
| Add setup resume banner | In App.tsx: if `localStorage['app-onboarding-complete'] === '1'` but `syncMode === 'synced'` and `syncStatus` is not fully configured, show a dismissible yellow banner: "Your sync setup isn't complete. [Continue setup →]" |

---

## Section F: Validation Plan

### Usability test script (5–10 minutes, non-technical parent)

**Setup:** Fresh install, no prior data. Observe silently. Do not help unless they are completely stuck.

**Task 1 — First run (3 min)**
> "Open SecurePass and get it set up to store your passwords. Use whatever option feels right to you."

Watch for:
- Do they understand "Just this computer" vs "Back up and sync"?
- Do they complete PIN setup without help?
- Do they read the vault passphrase warning?
- Do they write anything down?

Success: User reaches the main Passwords page without confusion and can articulate what each step was for.

**Task 2 — Lock and unlock (1 min)**
> "Lock the app, then open it again."

Watch for:
- Do they find the Lock Vault button?
- Do they remember their PIN (just set it)?

Success: Unlocks within 2 attempts.

**Task 3 — Sync setup (3 min, synced-capable device only)**
> "I've set up a sync server for you. Can you connect SecurePass to it?" [Provide URL and username.]

Watch for:
- Do they find the right place to start (Sidebar Sync button)?
- Do they understand "First time" vs "I already have an account"?
- Do they understand the QR code step?
- Do they know what to do with "Your secret key"?

Success: Completes account creation + MFA setup without backtracking.

**Task 4 — Find sync status (1 min)**
> "Are your passwords being backed up right now?"

Watch for: Do they look at the sidebar? Do they recognize the cloud icon meaning?

Success: Correctly identifies whether sync is active.

---

### Quantitative metrics (instrument after launch)

| Metric | Target | How to measure |
|---|---|---|
| Onboarding completion rate | > 85% | `app-onboarding-complete` set vs app opens |
| MFA setup rate among synced users | > 60% | `sync:mfaStatus` → `mfaEnabled` on first load |
| "Forgot PIN" usage | < 5% of sessions | Counter in settings |
| Sync error rate on unlock | < 2% | `lastSyncError` non-empty on unlock |
| Support queries about "two passwords" | Baseline → target 0 | User feedback channel |

---

### Acceptance criteria (definition of done per phase)

- [ ] A non-technical tester completes onboarding in < 4 minutes without asking for help
- [ ] PIN setup never appears as a surprise; it is always part of onboarding
- [ ] The vault passphrase warning is read by > 80% of test users (eye-tracking or verbal acknowledgment)
- [ ] The sync modal closes on both backdrop click and Esc keypress
- [ ] Focus is trapped inside the sync modal
- [ ] All interactive elements have accessible labels (axe DevTools: 0 critical violations)
- [ ] No `alert()` dialog is used anywhere in the UI
- [ ] "NFC Reader" and "Debug Terminal" are not visible to users who have `terminalEnabled = false`
- [ ] The Sidebar Sync button status icon is accompanied by visible text or `aria-label` explaining its meaning
- [ ] Sync error after unlock surfaces as a visible recoverable prompt, not a silent `console.warn`
- [ ] The copy phrase "vault key passphrase" is consistent in all locations