# SecurePass NFC 1.0.0 Release Checklist

## Branch and Build Hygiene
- [ ] `main` is green on CI (`lint`, `test`, `build`, packaging jobs).
- [ ] Working tree is clean (no unintended tracked changes, submodules reviewed).
- [ ] Version updated to `1.0.0` in `package.json`.

## Security and Trust
- [ ] Windows signing is configured and artifacts are signed.
- [ ] `npm audit --omit=dev --audit-level=critical` reviewed and accepted or fixed (matches CI gate).
- [ ] Known current high advisories tracked for remediation (not CI-gating):
  - [ ] `picomatch` (glob matching/ReDoS advisories)
  - [ ] `tar` via `cmake-js@7.x` dependency chain

## Updater Validation (Installed Builds)
- [ ] Auto update toggle persists across restarts.
- [ ] Toggle OFF: startup/interval checks do not auto-download.
- [ ] Toggle ON: eligible updates auto-download after checks.
- [ ] Manual `Check Now` still works and can fetch update when toggle is OFF.
- [ ] `Restart to Install` works end-to-end on Windows and Linux AppImage.
- [ ] Staged rollout state (`not-eligible`) is shown correctly.

## Core Product Regression
- [ ] First-run onboarding works for local mode and sync mode.
- [ ] Invite/bootstrap flow works on fresh sync server.
- [ ] Existing vault open/lock/PIN recovery flows behave as expected.
- [ ] Sync push/pull and SSE-triggered updates work across two devices.
- [ ] Browser extension registration and open-folder flow still work.

## Release and Post-Release
- [ ] GitHub release notes finalized for `v1.0.0`.
- [ ] Release workflow uploaded Windows installer + metadata + Linux AppImage assets.
- [ ] Smoke-test installer update path from latest `0.99.x` to `1.0.0`.
- [ ] Tag and changelog references are consistent (`SecurePass NFC` naming everywhere).
