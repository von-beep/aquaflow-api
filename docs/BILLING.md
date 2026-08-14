# Billing — Xendit (Phase 12)

AquaFlow uses **Xendit** (PH-friendly) for station subscriptions. Stripe is not used.

## Gated feature

**Cloud sync** (`POST /api/sync/pull` and `/push`) requires entitlement:

| `plan_status` | Rule |
|---------------|------|
| `active` | Allowed (paid subscription) |
| `trial` | Allowed while `trial_ends_at` is today or later (inclusive), or null |
| `suspended` | Blocked (`402 payment_required`) |

Local `localStorage` + JSON backup/restore stay available offline without a subscription.

Login already rejects `suspended` stations (Phase 7).

## Env (API)

| Variable | Purpose |
|----------|---------|
| `XENDIT_SECRET_KEY` | Secret API key (test or live) |
| `XENDIT_CALLBACK_TOKEN` | Dashboard webhook verification token (`x-callback-token`) |
| `XENDIT_PLAN_AMOUNT` | Monthly amount (default `499`) |
| `XENDIT_CURRENCY` | Default `PHP` |
| `XENDIT_COUNTRY` | Default `PH` |
| `XENDIT_PLAN_CODE` | Label stored on station (default `pro_monthly`) |
| `FRONTEND_URL` | Success/cancel return base (default `http://localhost:5173`) |

Never commit secret keys.

## API

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| `GET` | `/api/billing` | any auth | Plan status + entitlement |
| `POST` | `/api/billing/checkout` | owner | Create Xendit Payment Session (`SUBSCRIPTION` + `PAYMENT_LINK`) → `{ checkoutUrl }` |
| `POST` | `/api/billing/cancel` | owner | Deactivate recurring plan via Xendit |
| `POST` | `/webhooks/xendit` | Xendit | Plan activate / inactivate / cycle failed |

Checkout uses `POST https://api.xendit.co/sessions` with `session_type: SUBSCRIPTION`.

## Webhooks

In Xendit Dashboard → Settings → Webhooks, point **Subscriptions / recurring** (and payment session if available) to:

`https://<your-api-host>/webhooks/xendit`

Validate with header `x-callback-token` = `XENDIT_CALLBACK_TOKEN`.

Handled outcomes:

- `recurring.plan.activated`, `recurring.cycle.succeeded`, `payment_session.completed` → `plan_status = active`
- `recurring.plan.inactivated`, `recurring.cycle.failed` → `trial` if trial still valid, else `suspended`

## Frontend

Settings → **Billing** (owners): show status, **Upgrade with Xendit**, **Cancel subscription**.

## Test mode checklist

1. `npm run migrate` (applies `005_billing.sql`)
2. Set test `XENDIT_SECRET_KEY` + callback token
3. Owner opens Settings → Billing → Upgrade
4. Complete Xendit test checkout
5. Confirm webhook sets `plan_status = active`
6. Expired trial without pay → sync returns `402`
