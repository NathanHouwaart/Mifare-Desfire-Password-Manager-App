# Deploying the Sync Server with ngrok

This guide covers everything needed to safely expose the sync server to the internet
via an ngrok tunnel so family members can sync from anywhere.

---

## Prerequisites

- Raspberry Pi running Raspberry Pi OS (Bookworm/Bullseye) or any Debian-based Linux
- Node.js 20+ (see install commands at the bottom of this doc)
- PostgreSQL (see install commands at the bottom of this doc)
- An [ngrok account](https://dashboard.ngrok.com/) with an authtoken and a static domain

---

## 1. Configure environment variables

Copy `.env.example` to `.env` and fill in every value.

```
HOST=0.0.0.0
PORT=8787

DATABASE_URL=postgres://securepass:yourpassword@localhost:5432/securepass_sync

# Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_ACCESS_SECRET=<64-char random hex>
JWT_REFRESH_SECRET=<64-char random hex>

ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d

# One-time token used to create the very first account on the server.
# After bootstrapping your account, this endpoint won't accept new users (it checks that 0 users exist).
# Generate with: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
BOOTSTRAP_TOKEN=<random>

MFA_ISSUER=SecurePass

# Global rate limit (all routes)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100

# Stricter limit for auth endpoints (login, register, refresh) - 20 attempts per 15 min per IP
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20

# Required for ngrok: makes rate limiting per real client IP, not ngrok's gateway IP
TRUST_PROXY=true

# Set to your static ngrok domain so invite links are stable across restarts
PUBLIC_BASE_URL=https://your-static-domain.ngrok-free.app

# Set to false to block all new registrations entirely.
# When true, /register requires a valid per-user invite token.
ALLOW_REGISTRATION=true

# Invite management policy:
# - admin: only admin users (bootstrap owner) can create/list/revoke invites
# - any: any authenticated user can manage invites
INVITE_CREATION_POLICY=admin
```

> **Never commit `.env` to git.** It is already in `.gitignore`.

---

## 2. Set up ngrok

### Install ngrok (Raspberry Pi / Linux ARM64)

Use the official ngrok apt repository:
```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
```

### Authenticate
```bash
ngrok config add-authtoken <your-authtoken>
```

### Get your static domain
Go to **Ngrok Dashboard → Domains** and copy your free static domain
(e.g. `fox-bright-cobra.ngrok-free.app`). Set it as `PUBLIC_BASE_URL` in `.env`.

---

## 3. First-time setup: create your own account

The server requires an invite token to register. For the very first account (yours),
use the bootstrap endpoint instead — it only works when zero users exist.

Start the server:
```bash
npm run dev
```

Register yourself:
```bash
curl -s -X POST http://localhost:8787/v1/auth/bootstrap \
  -H "x-bootstrap-token: your-token-from-env" \
  -H "Content-Type: application/json" \
  -d '{"username": "nathan", "password": "your-strong-password", "deviceName": "desktop"}'
```

Save the returned `accessToken` — you will need it to create invites.

---

## 4. Start the ngrok tunnel

```bash
ngrok http --domain=your-static-domain.ngrok-free.app 8787
```

Your server is now reachable at `https://your-static-domain.ngrok-free.app`.

---

## 5. Invite family members

See [invite-system.md](./invite-system.md) for the full flow.

The short version — create a token and send it:
```bash
curl -s -X POST https://your-static-domain.ngrok-free.app/v1/invite/create \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"note": "for dad", "expiresIn": "2d"}'
```

Send your dad either the `token` (manual entry) or `inviteUrl` (one-tap deep link) from the response.

---

## Security summary

| Control | Status |
|---|---|
| TLS in transit | ngrok provides HTTPS end-to-end |
| Passwords | Argon2id (64 MB, 3 iterations) |
| Access tokens | JWT, 15 min expiry |
| Refresh tokens | Hashed in DB, single-use rotation |
| Rate limiting (global) | 100 req / 60 s per IP |
| Rate limiting (auth routes) | 20 req / 15 min per IP |
| Trust proxy | Enabled — rate limits per real client IP |
| Open registration | Blocked — invite token required |
| MFA | Optional TOTP per account |
| Helmet headers | Enabled |
| SQL injection | All queries parameterised |
| Input validation | Zod on every route |
| ngrok inspect dashboard | Only accessible on localhost:4040 (not exposed) |

---

## Keeping secrets safe

Generate strong random values for all secrets in `.env`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run this three times — once each for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
and `BOOTSTRAP_TOKEN`.

---

## Prerequisites — installing on Raspberry Pi

Make sure Node.js 20+ and PostgreSQL are installed:

```bash
# Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Create DB and user
sudo -u postgres psql -c "CREATE USER securepass WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "CREATE DATABASE securepass_sync OWNER securepass;"
```

---

## Stopping the tunnel

Simply `Ctrl+C` the ngrok process. The server continues running locally.
The tunnel restarts with the same domain next time you run the `ngrok http` command.
