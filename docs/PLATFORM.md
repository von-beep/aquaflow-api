# Platform ops (Phase 13)

Thin super-admin for listing tenants and suspending them. Not a full CRM.

## Super-admin model

| Mechanism | Detail |
|-----------|--------|
| Flag | `users.is_platform_admin = 1` |
| Home station | `s_platform` (`AquaFlow Platform`) — cannot be suspended via API |
| Demo login (after seed) | `admin@aquaflow.local` / `password123` |

Promote another user:

```sql
UPDATE users SET is_platform_admin = 1 WHERE email = 'you@example.com';
```

## API (Bearer JWT of a platform admin)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/stations` | List all stations + user counts + plan status + billing interval |
| `POST` | `/admin/stations` | Create station + owner (14-day trial); body `{ stationName, email, password }` |
| `POST` | `/admin/stations/:id/activate` | Manual activate: `{ billingInterval, expiryMode: "auto"\|"manual", planExpiresAt? }` |
| `PATCH` | `/admin/stations/:id/billing-interval` | Change renewal + expiry on an **active** station |
| `POST` | `/admin/stations/:id/suspend` | Set `plan_status = suspended`; stores previous status |
| `POST` | `/admin/stations/:id/unsuspend` | Restore previous `trial`/`active` (default `trial`) |

Non-admins receive `403`. Suspend / activate of `s_platform` is rejected.

## Manual activate

Ops can flip a **trial** station to **active**, set `billing_interval` to `monthly` or `yearly`, and set **`plan_expires_at`**:

- `expiryMode: "auto"` — expiry = today + 1 month or + 1 year  
- `expiryMode: "manual"` — require `planExpiresAt` (`YYYY-MM-DD`)

This does **not** start a Xendit subscription. Cloud sync is blocked after `plan_expires_at` for active stations.

## Suspended station behavior

| Surface | Behavior |
|---------|----------|
| `POST /auth/login` | `403` Station is suspended (platform admins exempt) |
| All `/api/*` | `403` via `rejectSuspendedStation` (covers lingering JWTs) |
| Sync | Also fails entitlement (`402` / suspended) |
| Local app | Offline `localStorage` still works on the device; cloud sync/login blocked |

## Clean station data

`POST /admin/stations` creates settings + inventory only (zeros). No products, customers, riders, deliveries, utang, or payments.

The React app resets local `aquaFlow_v1` to an empty workspace on station login/invite accept, then syncs from the server — so demo seed data on the device is not pushed into a new tenant.

## Promote without re-seed

1. Run `npm run migrate` (applies `006_platform_ops.sql`)
2. Create user on `s_platform` or set `is_platform_admin` on an existing user
3. Open `/platform` and sign in
