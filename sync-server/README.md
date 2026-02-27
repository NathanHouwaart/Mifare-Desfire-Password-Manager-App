# SecurePass Sync Server

Lightweight sync API for SecurePass encrypted vault rows.

## Endpoints
- `GET /v1/health`
- `GET /v1/auth/status`
- `POST /v1/auth/bootstrap`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
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
   - `BOOTSTRAP_TOKEN`
3. Start dev server:
   - `npm run dev`

## Build and run
- `npm run build`
- `npm run start`

## Env variables
- `HOST` default `0.0.0.0`
- `PORT` default `8787`
- `DATABASE_URL` required
- `JWT_ACCESS_SECRET` required (min 32 chars)
- `JWT_REFRESH_SECRET` required (min 32 chars)
- `ACCESS_TOKEN_TTL` default `15m`
- `REFRESH_TOKEN_TTL` default `30d`
- `BOOTSTRAP_TOKEN` required (min 16 chars)
- `RATE_LIMIT_WINDOW_MS` default `60000`
- `RATE_LIMIT_MAX` default `100`
