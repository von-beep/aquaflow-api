# API (Phase 8) — Tenant-scoped CRUD

All routes below require `Authorization: Bearer <token>` from `/auth/login` or `/auth/register`.  
Queries are always scoped to JWT `stationId`. Missing resources in **this** station return **404** (no cross-tenant leakage).

Base: `/api`

| Method | Path | Notes |
|--------|------|--------|
| GET | `/me` | Auth claims |
| GET/POST/PUT/DELETE | `/products`, `/products/:id` | |
| GET/POST/PUT/DELETE | `/customers`, `/customers/:id` | List includes `balance` + `clear`; DELETE cascades |
| GET/POST/PUT/DELETE | `/riders`, `/riders/:id` | |
| GET/POST/PUT/DELETE | `/deliveries`, `/deliveries/:id` | |
| POST | `/deliveries/:id/complete` | Body: `payment`, `fullOut`, `emptyIn`, `productName` |
| GET/POST/PUT/DELETE | `/utang` | Optional `?customerId=` |
| GET/POST/PUT/DELETE | `/payments` | Optional `?customerId=` |
| GET/PUT | `/settings` | Per-station singleton |
| GET/PUT | `/inventory` | Absolute counts |
| POST | `/inventory/refill` | `{ count }` empties → full |
| POST | `/inventory/adjust` | `{ fullDelta, emptyDelta }` |
| POST | `/sync/pull` | Body `{ since? }` — see [SYNC.md](./SYNC.md) |
| POST | `/sync/push` | Body `{ mutations: [...] }` — LWW |

Errors: `{ "error", "message" }` — `validation_error` (400), `not_found` (404), `unauthorized` (401), `forbidden` (403).

Auth details: [AUTH.md](./AUTH.md). Sync: [SYNC.md](./SYNC.md).
