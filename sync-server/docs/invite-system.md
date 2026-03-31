# Invite System

The sync server uses per-user, single-use, expiring invite tokens to control
who can create an account. There is no open self-registration.

By default, only admin users can create/list/revoke invites (`INVITE_CREATION_POLICY=admin`).
Set `INVITE_CREATION_POLICY=any` if any authenticated account should be able to invite others.

---

## How it works

1. A logged-in user creates an invite token via the API.
2. The raw token is returned **once** — it is never stored; only its SHA-256 hash is kept in the DB.
3. The invite recipient passes the raw token in the `x-invite-token` header when calling `POST /v1/auth/register`.
4. On use, the token is atomically marked as consumed — concurrent redemption attempts are blocked.
5. Expired or already-used tokens are rejected with a 403.

---

## API reference

### Create an invite token

```
POST /v1/invite/create
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "note": "for dad",       // optional label, max 120 chars
  "expiresIn": "2d"        // optional, any ms-compatible duration, default "24h"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "token": "64-char hex string — send this to the person",
  "inviteUrl": "securepass://invite?server=https%3A%2F%2F...&token=...",
  "serverUrl": "https://your-static-domain.ngrok-free.app",
  "note": "for dad",
  "expiresAt": "2026-04-02T10:00:00.000Z",
  "createdAt": "2026-03-31T10:00:00.000Z"
}
```

> The `token` field is the only time the raw value is available. Copy it and send it
> to your family member via a secure channel (Signal, iMessage, etc.).
> `inviteUrl` includes the same token for one-tap deep-link onboarding.

---

### List your invite tokens

```
GET /v1/invite/list
Authorization: Bearer <access-token>
```

**Response 200:**
```json
{
  "invites": [
    {
      "id": "uuid",
      "note": "for dad",
      "expiresAt": "2026-04-02T10:00:00.000Z",
      "expired": false,
      "used": false,
      "usedAt": null,
      "createdAt": "2026-03-31T10:00:00.000Z"
    }
  ]
}
```

> The raw token is **not** returned here — only metadata.
> If you need to resend the token, revoke the old one and create a new one.

---

### Revoke an unused invite

```
DELETE /v1/invite/:id
Authorization: Bearer <access-token>
```

Returns `204 No Content` on success.
Returns `404` if the invite doesn't exist, belongs to someone else, or has already been used.

---

## Registration with an invite token

```
POST /v1/auth/register
x-invite-token: <raw token from invite creator>
Content-Type: application/json

{
  "username": "dad",
  "password": "strong-password-min-10-chars",
  "deviceName": "dads-phone"
}
```

**Response 201:** full session object (userId, accessToken, refreshToken, etc.)

---

## Typical flow

```
You                              Dad
 |                                |
 |-- POST /v1/invite/create ----> server
 |<-- { token: "abc123..." } ----|
 |                                |
 |-- (send token via Signal) ---> Dad
 |                                |
 |                                |-- POST /v1/auth/register (x-invite-token: abc123...)
 |                                |<-- { accessToken, userId, ... }
 |                                |
 |                           Dad is now registered.
 |                           Token is consumed and cannot be reused.
```

---

## Notes

- Tokens expire after the duration you specify (default 24 h). Create a new one if it
  lapses before the person registers.
- `ALLOW_REGISTRATION=false` in `.env` disables `POST /v1/auth/register` entirely,
  regardless of invite tokens. Use this to lock down the server completely.
- `INVITE_CREATION_POLICY=admin` (default) limits invite management to admin users.
- The first account created via bootstrap is automatically marked admin.
- The first account (yours) is created via `POST /v1/auth/bootstrap` using the
  `BOOTSTRAP_TOKEN` — no invite needed. See [ngrok-deployment.md](./ngrok-deployment.md).
