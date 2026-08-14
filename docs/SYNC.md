# Sync protocol (Phase 9)

Station-scoped push/pull for offline clients. **Conflict policy: last-write-wins (LWW) per record** — the mutation with the greater-or-equal `updatedAt` wins.

Auth: `Authorization: Bearer <token>` (JWT `stationId`).

Base: `/api/sync`

---

## Collections

| Collection | Record `id` | Soft delete |
|------------|-------------|-------------|
| `products`, `customers`, `riders`, `deliveries`, `utang`, `payments` | entity id | yes (`deletedAt`) |
| `settings`, `inventory` | **must equal** `stationId` | no |

---

## `POST /api/sync/pull`

### Request

```json
{ "since": "2026-01-01T00:00:00.000Z" }
```

Omit/`""`/`null` `since` → full sync from epoch.

### Response

```json
{
  "serverTime": "2026-08-04T01:23:45.678Z",
  "records": [
    {
      "collection": "products",
      "id": "p1",
      "updatedAt": "2026-08-04T01:20:00.000Z",
      "deletedAt": null,
      "data": { "name": "Slim Gallon", "price": 25 }
    },
    {
      "collection": "products",
      "id": "p9",
      "updatedAt": "2026-08-04T01:22:00.000Z",
      "deletedAt": "2026-08-04T01:22:00.000Z",
      "data": null
    }
  ]
}
```

Client should set next `since` to `serverTime` after applying records.

Tombstones: `deletedAt != null` and `data: null` — remove local copy.

---

## `POST /api/sync/push`

### Request

```json
{
  "mutations": [
    {
      "collection": "products",
      "id": "p_new",
      "op": "upsert",
      "updatedAt": "2026-08-04T01:30:00.000Z",
      "data": { "name": "Round", "price": 30 }
    },
    {
      "collection": "products",
      "id": "p_old",
      "op": "delete",
      "updatedAt": "2026-08-04T01:31:00.000Z"
    }
  ]
}
```

### Response

```json
{
  "applied": [{ "collection": "products", "id": "p_new", "op": "upsert" }],
  "conflicts": [
    {
      "collection": "products",
      "id": "p_old",
      "reason": "lww_lost",
      "serverUpdatedAt": "2026-08-04T01:32:00.000Z",
      "message": "Server record is newer (last-write-wins)"
    }
  ]
}
```

On `lww_lost`, client should pull and keep the server version.

---

## LWW rules

1. Compare client `updatedAt` to server `updated_at`.
2. Apply if client time **≥** server time (or row missing).
3. Otherwise return `conflicts[]` with `reason: "lww_lost"` — **do not** overwrite server.
4. Successful upsert clears `deleted_at` (undelete).
5. Delete sets `deleted_at` + `updated_at` to client time.
6. Cross-station: JWT scopes all queries — other tenants’ rows are never returned or written.

---

## Phase 10 client notes

1. Keep writing `localStorage` first; queue mutations with wall-clock `updatedAt`.
2. On reconnect: **push** dirty mutations, then **pull** with last `serverTime`.
3. Apply pull records (including tombstones) into local state.
4. Surface `conflicts` via toast; re-pull if needed.
