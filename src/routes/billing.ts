import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { isStationEntitled } from '../billing/entitlement.js'
import {
  createSubscriptionSession,
  deactivateRecurringPlan,
  isXenditConfigured,
  XenditError,
} from '../billing/xendit.js'
import { getPool } from '../db/pool.js'
import { toDateOnlyString } from '../lib/dates.js'
import { badRequest, stationId } from '../lib/http.js'
import { requireOwner } from '../middleware/requireOwner.js'

const PLAN_CODE = () => process.env.XENDIT_PLAN_CODE?.trim() || 'pro_monthly'
const PLAN_AMOUNT = () => Number(process.env.XENDIT_PLAN_AMOUNT ?? 499)
const CURRENCY = () => process.env.XENDIT_CURRENCY?.trim() || 'PHP'
const COUNTRY = () => process.env.XENDIT_COUNTRY?.trim() || 'PH'
const FRONTEND_URL = () =>
  (process.env.FRONTEND_URL ?? process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')

type StationBillingRow = RowDataPacket & {
  id: string
  name: string
  plan_status: string
  plan_code: string | null
  billing_interval: string | null
  plan_expires_at: Date | string | null
  trial_ends_at: Date | string | null
  xendit_customer_ref: string | null
  xendit_plan_id: string | null
  xendit_session_id: string | null
  xendit_checkout_ref: string | null
}

function mapBilling(row: StationBillingRow, entitled: boolean) {
  return {
    planStatus: row.plan_status,
    planCode: row.plan_code,
    billingInterval: row.billing_interval,
    planExpiresAt: toDateOnlyString(row.plan_expires_at),
    trialEndsAt: toDateOnlyString(row.trial_ends_at),
    entitled,
    xenditPlanId: row.xendit_plan_id,
    amount: PLAN_AMOUNT(),
    currency: CURRENCY(),
    configured: isXenditConfigured(),
  }
}

async function loadStation(sid: string): Promise<StationBillingRow | null> {
  const [rows] = await getPool().query<StationBillingRow[]>(
    `SELECT id, name, plan_status, plan_code, billing_interval, plan_expires_at, trial_ends_at,
            xendit_customer_ref, xendit_plan_id, xendit_session_id, xendit_checkout_ref
     FROM stations WHERE id = ? LIMIT 1`,
    [sid],
  )
  return (rows as StationBillingRow[])[0] ?? null
}

export const billingRouter = Router()

billingRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const row = await loadStation(sid)
  if (!row) {
    res.status(404).json({ error: 'not_found', message: 'Station not found' })
    return
  }
  const entitled = isStationEntitled({
    planStatus: row.plan_status,
    trialEndsAt: toDateOnlyString(row.trial_ends_at),
    planExpiresAt: toDateOnlyString(row.plan_expires_at),
  })
  res.json({ billing: mapBilling(row, entitled) })
})

/** Owner: start Xendit subscription checkout (hosted payment link). */
billingRouter.post('/checkout', requireOwner, async (req, res) => {
  if (!isXenditConfigured()) {
    res.status(503).json({
      error: 'billing_not_configured',
      message: 'Xendit is not configured (set XENDIT_SECRET_KEY)',
    })
    return
  }

  const sid = stationId(req)
  const row = await loadStation(sid)
  if (!row) {
    res.status(404).json({ error: 'not_found', message: 'Station not found' })
    return
  }

  const [userRows] = await getPool().query<RowDataPacket[]>(
    `SELECT email FROM users WHERE id = ? AND station_id = ? LIMIT 1`,
    [req.auth!.id, sid],
  )
  const email = String((userRows as RowDataPacket[])[0]?.email ?? '')
  if (!email) {
    badRequest(res, 'Owner email not found')
    return
  }

  const amount = PLAN_AMOUNT()
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(500).json({
      error: 'server_error',
      message: 'Invalid XENDIT_PLAN_AMOUNT',
    })
    return
  }

  const planCode = PLAN_CODE()
  const frontend = FRONTEND_URL()

  try {
    const { session, checkoutRef, customerRef } = await createSubscriptionSession({
      stationId: sid,
      stationName: row.name,
      ownerEmail: email,
      amount,
      currency: CURRENCY(),
      country: COUNTRY(),
      successUrl: `${frontend}/admin/settings?billing=success`,
      cancelUrl: `${frontend}/admin/settings?billing=cancel`,
      planCode,
    })

    const link = session.payment_link_url
    if (!link || typeof link !== 'string') {
      res.status(502).json({
        error: 'billing_error',
        message: 'Xendit session missing payment_link_url',
      })
      return
    }

    await getPool().query<ResultSetHeader>(
      `UPDATE stations
       SET xendit_checkout_ref = ?,
           xendit_session_id = ?,
           xendit_customer_ref = ?,
           plan_code = ?
       WHERE id = ?`,
      [
        checkoutRef,
        session.payment_session_id ?? null,
        customerRef,
        planCode,
        sid,
      ],
    )

    res.status(201).json({
      checkoutUrl: link,
      sessionId: session.payment_session_id ?? null,
      referenceId: checkoutRef,
    })
  } catch (err) {
    if (err instanceof XenditError) {
      res.status(502).json({
        error: 'billing_error',
        message: err.message,
      })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Checkout failed' })
  }
})

/** Owner: cancel / deactivate Xendit recurring plan. */
billingRouter.post('/cancel', requireOwner, async (req, res) => {
  const sid = stationId(req)
  const row = await loadStation(sid)
  if (!row) {
    res.status(404).json({ error: 'not_found', message: 'Station not found' })
    return
  }
  if (!row.xendit_plan_id) {
    badRequest(res, 'No active Xendit plan to cancel')
    return
  }
  if (!isXenditConfigured()) {
    res.status(503).json({
      error: 'billing_not_configured',
      message: 'Xendit is not configured (set XENDIT_SECRET_KEY)',
    })
    return
  }

  try {
    await deactivateRecurringPlan(row.xendit_plan_id)
  } catch (err) {
    if (err instanceof XenditError) {
      res.status(502).json({ error: 'billing_error', message: err.message })
      return
    }
    throw err
  }

  const stillTrial = isStationEntitled({
    planStatus: 'trial',
    trialEndsAt: toDateOnlyString(row.trial_ends_at),
  })
  const nextStatus = stillTrial ? 'trial' : 'suspended'

  await getPool().query<ResultSetHeader>(
    `UPDATE stations
     SET plan_status = ?, xendit_plan_id = NULL
     WHERE id = ?`,
    [nextStatus, sid],
  )

  const updated = await loadStation(sid)
  const entitled = isStationEntitled({
    planStatus: updated!.plan_status,
    trialEndsAt: toDateOnlyString(updated!.trial_ends_at),
    planExpiresAt: toDateOnlyString(updated!.plan_expires_at),
  })
  res.json({ billing: mapBilling(updated!, entitled) })
})
