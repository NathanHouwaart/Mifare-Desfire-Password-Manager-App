# SecurePass Sync Setup (What To Fill In Where)

This guide tells you exactly which values you must fill in:
- in `deploy/pi-sync/.env`
- in the SecurePass sync wizard inside the app

## 1. Copy `.env.example` to `.env`

```bash
cd /opt/securepass/deploy/pi-sync
cp .env.example .env
```

If you get permission errors, use `sudo` and/or fix folder ownership.

## 2. Fill `.env` values

Open `deploy/pi-sync/.env` and set these:

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
| `BOOTSTRAP_TOKEN` | Legacy token, keep random anyway | random 32+ chars |
| `ACCESS_TOKEN_TTL` | Access token lifetime | `15m` |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime | `30d` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `60000` |
| `RATE_LIMIT_MAX` | Max requests per window | `100` |

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
| `Authenticator Code` | 6-digit TOTP from app (after MFA setup) | `123456` |
| `Vault Key Passphrase` | Passphrase used to wrap shared vault key, must be the same on all your devices | long memorable passphrase |

## 5. First device flow

1. Open wizard.
2. Enter `Sync URL`, `Username`, `Device Name`.
3. Register account with `Sync Password` (or login if account already exists).
4. Setup MFA and enable it with 6-digit code.
5. Initialize vault key with `Vault Key Passphrase`.
6. Finish wizard.

## 6. Second device flow

1. Open wizard.
2. Enter same `Sync URL` and same `Username`.
3. Login with same `Sync Password` and MFA code.
4. Unlock vault key using the same `Vault Key Passphrase` from first device.
5. Finish wizard and sync.

## 7. Local vs Synced mode

- `Use Locally`: disables sync on this device and clears local sync session/config.
- `Use Synced`: opens the wizard for account setup/login and key unlock.

You can switch modes later from Settings.

