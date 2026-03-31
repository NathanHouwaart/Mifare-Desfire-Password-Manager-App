# SecurePass Sync Server

Lightweight sync API for SecurePass encrypted vault rows.

## Endpoints
- `GET /v1/health`
- `GET /v1/invite/link`
- `GET /v1/invite/open`
- `POST /v1/invite/create`
- `GET /v1/invite/list`
- `DELETE /v1/invite/:id`
- `GET /v1/auth/status`
- `GET /v1/auth/me`
- `POST /v1/auth/register`
- `POST /v1/auth/bootstrap`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/auth/mfa/status`
- `POST /v1/auth/mfa/setup`
- `POST /v1/auth/mfa/enable`
- `POST /v1/auth/mfa/disable`
- `GET /v1/keys/envelope`
- `PUT /v1/keys/envelope`
- `POST /v1/sync/push`
- `GET /v1/sync/pull`
- `GET /v1/sync/cursor`

## Run locally
1. Install dependencies:
   - `npm install`
2. Set env vars (`.env` supported):
   - `DATABASE_URL`
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - `BOOTSTRAP_TOKEN` (used by /v1/auth/bootstrap to create the first account)
3. Start dev server:
   - `npm run dev`

## Build and run
- `npm run build`
- `npm run start`

## Env variables
- `HOST` default `0.0.0.0`
- `PORT` default `8787`
- `PUBLIC_BASE_URL` optional (used for invite links behind reverse proxies)
- `DATABASE_URL` required
- `JWT_ACCESS_SECRET` required (min 32 chars)
- `JWT_REFRESH_SECRET` required (min 32 chars)
- `ACCESS_TOKEN_TTL` default `15m`
- `REFRESH_TOKEN_TTL` default `30d`
- `MFA_ISSUER` default `SecurePass`
- `BOOTSTRAP_TOKEN` required (min 16 chars, used once to create the first account)
- `RATE_LIMIT_WINDOW_MS` default `60000`
- `RATE_LIMIT_MAX` default `100`
- `AUTH_RATE_LIMIT_WINDOW_MS` default `900000`
- `AUTH_RATE_LIMIT_MAX` default `20`
- `ALLOW_REGISTRATION` default `true`
- `INVITE_CREATION_POLICY` default `admin` (`admin` or `any`)
- `TRUST_PROXY` default `false`
