# SecurePass Sync MVP (Card-Only Unlock Preserved)

This scaffold adds a sync API and deployment stack without changing your current NFC-per-use unlock flow.

## Security model
- Server stores encrypted vault rows only (`ciphertext`, `iv`, `authTag`) plus metadata.
- Server never decrypts vault data.
- You still tap your NFC card every time you view/fill credentials in the app.
- API auth (username/password + JWT) protects sync access. This is separate from vault decryption.

## What is included
- `sync-server/` Node + TypeScript API
  - `POST /v1/auth/bootstrap`
  - `POST /v1/auth/login`
  - `POST /v1/auth/refresh`
  - `POST /v1/auth/logout`
  - `GET /v1/keys/envelope`
  - `PUT /v1/keys/envelope`
  - `POST /v1/sync/push`
  - `GET /v1/sync/pull`
  - `GET /v1/sync/cursor`
  - `GET /v1/health`
- `deploy/pi-sync/docker-compose.yml`
  - API container
  - PostgreSQL container
- `deploy/pi-sync/.env.example`

## Raspberry Pi + Portainer setup
1. Copy `deploy/pi-sync/.env.example` to `deploy/pi-sync/.env`.
2. Fill in strong secrets in `.env`.
3. In Portainer, deploy stack from `deploy/pi-sync/docker-compose.yml`.
4. Keep `SYNC_BIND_IP=127.0.0.1` if you use Tailscale/WireGuard on host.
5. Access API over your VPN IP (not open internet).

## Bootstrap first account
Call once after deployment:

```bash
curl -X POST http://<pi-vpn-ip>:8787/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-token: <BOOTSTRAP_TOKEN>" \
  -d '{
    "username":"nathan",
    "password":"<strong-api-password>",
    "deviceName":"desktop-main"
  }'
```

After bootstrap, the endpoint returns `409` and cannot be reused unless DB is reset.

## LWW conflict behavior (current MVP)
- Sync uses last-write-wins by `updatedAt` (number from client).
- Older or same-timestamp updates are skipped as `stale_or_duplicate`.

## Current app integration state
- Main-process sync plumbing is in place (`sync:*` IPC handlers + local sync outbox/cursor tables).
- Settings page now includes Sync controls for:
  - endpoint/username/device config
  - bootstrap/login/logout
  - vault key envelope init/unlock/lock
  - manual `Sync Now`
  - local sync reset
- Main process runs background sync every 2 minutes when sync is configured and logged in.

## Portable key flow (Phase 1)
- On your first/original device:
  - Login to sync.
  - In Settings -> Sync -> Vault Key, click `Initialize` once.
  - This wraps the current local machine secret into a password-protected envelope and uploads it.
- On each additional device:
  - Login to sync.
  - In Settings -> Sync -> Vault Key, enter the same passphrase and click `Unlock`.
  - Card auth + entry decrypt now use the unlocked shared root key, so the same DESFire card works across devices.

Notes:
- You still tap the card for each credential decrypt/fill.
- If you click `Lock` or restart app, unlock again on that device before card operations.
