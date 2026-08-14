# Aquaflow-api

Express + MySQL backend for [AquaFlow](../Aquaflow) — offline-first **multi-tenant SaaS** for water-refilling stations.

**Not a monorepo** — this repo is a sibling of the React app (`Aquaflow`). Shared contract is HTTP JSON only.

Phase roadmap: see Aquaflow `docs/BACKEND_ROADMAP.md` and `docs/backend-phases.md`.

## Stack

- Node.js 20+
- Express + TypeScript
- MySQL 8
- mysql2 + versioned SQL files in `migrations/`
- Multi-tenant `station_id` (from Phase 7)
- Auth: bcrypt + JWT (Phase 7); Stripe billing (Phase 12)

## Setup

### 1. Start MySQL (Docker) or create DB manually

**Docker Compose** (recommended):

```bash
docker compose up -d
```

Wait until healthy, then continue.

- MySQL: `127.0.0.1:3306`
- phpMyAdmin: http://localhost:8080 (user `aquaflow` / `aquaflow`, or `root` / `root`)

**Manual SQL:**

```sql
CREATE DATABASE aquaflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'aquaflow'@'localhost' IDENTIFIED BY 'aquaflow';
GRANT ALL PRIVILEGES ON aquaflow.* TO 'aquaflow'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Configure env

```bash
cp .env.example .env
```

Edit `.env` as needed:

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3001`) |
| `DATABASE_URL` | `mysql://user:pass@host:3306/aquaflow` |
| `JWT_SECRET` | Required for Phase 7+ auth |

Discrete `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` work if `DATABASE_URL` is unset.

### 3. Install & migrate

```bash
npm install
npm run migrate
npm run seed
```

### 4. Run

```bash
npm run dev      # watch mode
# or
npm run build && npm start
```

Health check:

```bash
curl http://localhost:3001/health
# { "ok": true, "db": true }
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start API with `tsx` watch |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run migrate` | Apply pending `migrations/*.sql` |
| `npm run seed` | Reset demo data (mirrors frontend seed) |

## Domain tables

**Phase 6:** `settings`, `inventory`, `products`, `customers`, `riders`, `deliveries`, `utang`, `payments`.

**Phase 7:** `stations` (tenant), `users`, and **`station_id`** on all domain tables. Settings/inventory are one row per station.

## Auth

See [docs/AUTH.md](./docs/AUTH.md) for register/login, JWT (`sub` + `stationId`), and error shapes.

Demo after seed: `owner@demo.local` / `password123`

## Phase status

**Phase 13 — Platform ops** complete. Roadmap Phases 6–13 delivered.

- API: [docs/API.md](./docs/API.md)
- Auth: [docs/AUTH.md](./docs/AUTH.md)
- Sync: [docs/SYNC.md](./docs/SYNC.md)
- Onboarding: [docs/ONBOARDING.md](./docs/ONBOARDING.md)
- Billing: [docs/BILLING.md](./docs/BILLING.md)
- Platform: [docs/PLATFORM.md](./docs/PLATFORM.md)
