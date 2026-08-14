# Auth (Phase 7)

## Token

- Algorithm: HS256 JWT
- Secret: `JWT_SECRET` env var
- Claims: `sub` (user id), `stationId` (tenant id)
- Lifetime: **7 days** (`expiresIn: "7d"`)
- Header: `Authorization: Bearer <token>`

## Endpoints

### `POST /auth/register`

Creates a **station** (tenant) + **owner** user, empty settings/inventory for that station.

```json
{
  "stationName": "My Water Station",
  "email": "owner@example.com",
  "password": "at-least-8-chars",
  "slug": "optional-slug"
}
```

**201** response includes `token`, `expiresIn`, `user`, `station` (with `planStatus: trial` and `trialEndsAt` = signup + **14 days**).

**400** `validation_error` — missing fields / short password  
**409** `conflict` — email or slug already used

Invites and station profile: see [ONBOARDING.md](./ONBOARDING.md).

### `POST /auth/login`

Email is **globally unique**. Body: `{ "email", "password" }`.

**200** — same shape as register  
**401** `unauthorized` — bad credentials  
**403** `forbidden` — station `plan_status` is `suspended`

### `GET /auth/me` (Bearer required)

Returns the authenticated user.

### `GET /api/me` / `POST /api/_auth-check` (Bearer required)

Protected API surface. All future CRUD/sync routes mount under `/api` and use the same middleware.

## Error shapes

| Status | `error` | When |
|--------|---------|------|
| 401 | `unauthorized` | Missing/invalid/expired Bearer token, or bad login |
| 403 | `forbidden` | Cross-tenant access, or suspended station |
| 400 | `validation_error` | Bad request body |
| 409 | `conflict` | Duplicate email/slug |

Example:

```json
{ "error": "unauthorized", "message": "Invalid or expired token" }
```

## Demo seed

After `npm run seed`:

- Email: `owner@demo.local`
- Password: `password123`
- Station id: `s_demo`
