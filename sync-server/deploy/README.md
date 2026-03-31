# SecurePass Sync Setup (What To Fill In Where)

This guide tells you exactly which values you must fill in:
- in `sync-server/deploy/.env`
- in the SecurePass sync wizard inside the app

## 1. Copy `.env.example` to `.env`

```bash
cd /opt/securepass/sync-server/deploy
cp .env.example .env
```

If you get permission errors, use `sudo` and/or fix folder ownership.

## 2. Fill `.env` values

Open `sync-server/deploy/.env` and set these:

| Variable | What to fill | Example |
|---|---|---|
| `SYNC_BIND_IP` | `127.0.0.1` if using Tailscale/WireGuard on Pi host. Use `0.0.0.0` only for direct LAN access. | `127.0.0.1` |
| `SYNC_PORT` | API port | `8787` |
| `POSTGRES_DB` | Database name | `securepass_sync` |
| `POSTGRES_USER` | DB user | `securepass` |
| `POSTGRES_PASSWORD` | Strong DB password | random 32+ chars |
| `POSTGRES_BIND_IP` | Same rule as sync bind ip | `127.0.0.1` |
| `POSTGRES_PORT` | Postgres port | `5432` |
| `JWT_ACCESS_SECRET` | Strong random secret, minimum 32 chars | random 48+ chars |
| `JWT_REFRESH_SECRET` | Another different strong random secret, minimum 32 chars | random 48+ chars |
| `MFA_ISSUER` | Name shown in authenticator app | `SecurePass` |
| `BOOTSTRAP_TOKEN` | Used once to create the first account (only works when 0 users exist) | random 32+ chars |
| `ACCESS_TOKEN_TTL` | Access token lifetime | `15m` |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime | `30d` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `60000` |
| `RATE_LIMIT_MAX` | Max requests per window | `100` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Auth route rate-limit window | `900000` |
| `AUTH_RATE_LIMIT_MAX` | Auth route max attempts per window | `20` |
| `PUBLIC_BASE_URL` | Public HTTPS URL used in invite links | `https://your-domain.ngrok-free.app` |
| `ALLOW_REGISTRATION` | Allow new registrations (invite token still required) | `true` |
| `INVITE_CREATION_POLICY` | Who can create invites (`admin` or `any`) | `admin` |

Quick way to generate secure random values on Linux:

```bash
openssl rand -base64 48
```

## 3. Start stack

```bash
docker compose up -d --build
```

Health check:

```bash
curl http://<pi-ip>:8787/v1/health
```

Expected:

```json
{"status":"ok","now":"..."}
```

## 4. Fill values in SecurePass wizard

When you click `Use Synced` or `Open Sync Wizard`, fill:

| Wizard field | What to fill | Example |
|---|---|---|
| `Sync URL` | Base URL to your API | `http://192.168.10.2:8787` or `http://100.x.y.z:8787` |
| `Username` | Sync account username | `nathan` |
| `Device Name` | Friendly device label | `desktop-main`, `laptop-mac` |
| `Sync Password` | Account password for sync login/register | your chosen strong password |
| `Invite Token` | Required when creating an invited account | token from owner |
| `Bootstrap Token` | Required once on a fresh server with zero users | value of `BOOTSTRAP_TOKEN` |
| `Authenticator Code` | 6-digit TOTP from app (after MFA setup) | `123456` |
| `Account Password (for Vault Key)` | Same sync account password, used to prepare/unlock vault key on device | same as `Sync Password` |

## 5. First device flow

1. Open wizard.
2. Enter `Sync URL`, `Username`, `Device Name`.
3. If this is a fresh server (0 users): bootstrap owner with `Bootstrap Token`.
4. Otherwise: register with `Sync Password` + `Invite Token` (or login if account already exists).
5. Setup MFA and enable it with 6-digit code.
6. Vault key is prepared automatically from your account password.
7. Finish wizard.

## 6. Second device flow

1. Open wizard.
2. Enter same `Sync URL` and same `Username`.
3. Login with same `Sync Password` and MFA code.
4. If prompted, prepare/unlock vault key using your account password.
5. Finish wizard and sync.

## 7. Local vs Synced mode

- `Use Locally`: disables sync on this device and clears local sync session/config.
- `Use Synced`: opens the wizard for account setup/login and key unlock.

You can switch modes later from Settings.
