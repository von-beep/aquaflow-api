# Onboarding (Phase 11)

## Trial defaults

| Field | Value |
|-------|--------|
| `plan_status` | `trial` on register |
| `trial_ends_at` | **14 days** from signup date |
| Billing | Phase 12 (Stripe) — trial is not gated yet |

## Public signup

`POST /auth/register`

```json
{ "stationName": "My Station", "email": "owner@example.com", "password": "min8chars" }
```

Creates station + owner + empty settings/inventory. Response includes `station.trialEndsAt`.

Frontend: `/signup`

## Invites (owner only)

1. `POST /api/invites` `{ "email"? }` → invite token (7 days)
2. Share `{origin}/invite/{token}`
3. `GET /auth/invites/:token` — preview
4. `POST /auth/invites/:token/accept` `{ email, password }` → staff user + JWT

Frontend: Settings → **Team invites** (owners); `/invite/:token` accept page.

## Station profile

- `GET /api/station` — name, phone, plan, trialEndsAt
- `PATCH /api/station` (owner) — updates `stations` + mirrors into `settings` for sync
