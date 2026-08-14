import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { toDateOnlyString } from '../lib/dates.js'
import { badRequest, notFound } from '../lib/http.js'
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin.js'
import {
  parseBillingInterval,
  resolvePlanExpiresAt,
  type BillingInterval,
} from '../platform/billingInterval.js'
import { createStationWithOwner } from '../platform/createStation.js'
import { PLATFORM_STATION_ID, planStatusAfterUnsuspend } from '../platform/planRestore.js'

type StationListRow = RowDataPacket & {
  id: string
  name: string
  slug: string
  phone: string
  plan_status: string
  previous_plan_status: string | null
  trial_ends_at: Date | string | null
  plan_code: string | null
  billing_interval: string | null
  plan_expires_at: Date | string | null
  created_at: Date | string
  user_count: number
}

function mapStation(r: StationListRow) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    phone: r.phone ?? '',
    planStatus: r.plan_status,
    previousPlanStatus: r.previous_plan_status,
    trialEndsAt: toDateOnlyString(r.trial_ends_at),
    planCode: r.plan_code,
    billingInterval: (r.billing_interval as BillingInterval | null) ?? null,
    planExpiresAt: toDateOnlyString(r.plan_expires_at),
    createdAt:
      typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
    userCount: Number(r.user_count),
  }
}

const STATION_SELECT = `SELECT s.id, s.name, s.slug, s.phone, s.plan_status, s.previous_plan_status,
            s.trial_ends_at, s.plan_code, s.billing_interval, s.plan_expires_at, s.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.station_id = s.id) AS user_count
     FROM stations s`

async function loadStation(id: string): Promise<StationListRow | null> {
  const [rows] = await getPool().query<StationListRow[]>(
    `${STATION_SELECT} WHERE s.id = ? LIMIT 1`,
    [id],
  )
  return (rows as StationListRow[])[0] ?? null
}

export const adminRouter = Router()

adminRouter.use(requirePlatformAdmin)

adminRouter.get('/stations', async (_req, res) => {
  const [rows] = await getPool().query<StationListRow[]>(
    `${STATION_SELECT} ORDER BY s.created_at DESC`,
  )
  res.json({ stations: (rows as StationListRow[]).map(mapStation) })
})

/** Create a new tenant station + owner (14-day trial). Does not return an owner JWT. */
adminRouter.post('/stations', async (req, res) => {
  const stationName =
    typeof req.body?.stationName === 'string' ? req.body.stationName.trim() : ''
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const created = await createStationWithOwner(conn, { stationName, email, password })
    await conn.commit()

    const full = await loadStation(created.stationId)
    res.status(201).json({
      station: mapStation(full!),
      owner: { id: created.userId, email: created.email },
    })
  } catch (err: unknown) {
    await conn.rollback()
    const code = (err as { code?: string }).code
    if (code === 'VALIDATION') {
      badRequest(res, err instanceof Error ? err.message : 'Invalid input')
      return
    }
    if (code === 'ER_DUP_ENTRY') {
      res.status(409).json({
        error: 'conflict',
        message: 'Email or station slug already in use',
      })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Failed to create station' })
  } finally {
    conn.release()
  }
})

/**
 * Manual activate (ops / offline payment). Sets plan_status=active and billing_interval.
 * Does not create a Xendit subscription.
 */
adminRouter.post('/stations/:id/activate', async (req, res) => {
  const id = String(req.params.id ?? '')
  if (!id) {
    badRequest(res, 'Station id required')
    return
  }
  if (id === PLATFORM_STATION_ID) {
    badRequest(res, 'Cannot change plan on the platform ops station')
    return
  }

  const interval = parseBillingInterval(req.body?.billingInterval ?? req.body?.interval)
  if (!interval) {
    badRequest(res, 'billingInterval must be monthly or yearly')
    return
  }

  const expiry = resolvePlanExpiresAt({
    billingInterval: interval,
    expiryMode: req.body?.expiryMode,
    planExpiresAt: req.body?.planExpiresAt,
  })
  if ('error' in expiry) {
    badRequest(res, expiry.error)
    return
  }

  const existing = await loadStation(id)
  if (!existing) {
    notFound(res, 'Station')
    return
  }
  if (existing.plan_status === 'suspended') {
    badRequest(res, 'Unsuspend the station before activating')
    return
  }

  await getPool().query<ResultSetHeader>(
    `UPDATE stations
     SET plan_status = 'active',
         billing_interval = ?,
         plan_expires_at = ?,
         previous_plan_status = NULL,
         plan_code = COALESCE(plan_code, ?)
     WHERE id = ?`,
    [interval, expiry.expiresAt, interval === 'yearly' ? 'pro_yearly' : 'pro_monthly', id],
  )

  const full = await loadStation(id)
  res.json({ station: mapStation(full!) })
})

/** Update renewal interval + expiry on an already-active station (manual billing). */
adminRouter.patch('/stations/:id/billing-interval', async (req, res) => {
  const id = String(req.params.id ?? '')
  if (!id) {
    badRequest(res, 'Station id required')
    return
  }
  if (id === PLATFORM_STATION_ID) {
    badRequest(res, 'Cannot change plan on the platform ops station')
    return
  }

  const interval = parseBillingInterval(req.body?.billingInterval ?? req.body?.interval)
  if (!interval) {
    badRequest(res, 'billingInterval must be monthly or yearly')
    return
  }

  const expiry = resolvePlanExpiresAt({
    billingInterval: interval,
    expiryMode: req.body?.expiryMode,
    planExpiresAt: req.body?.planExpiresAt,
  })
  if ('error' in expiry) {
    badRequest(res, expiry.error)
    return
  }

  const existing = await loadStation(id)
  if (!existing) {
    notFound(res, 'Station')
    return
  }
  if (existing.plan_status !== 'active') {
    badRequest(res, 'Station must be active to change billing interval')
    return
  }

  await getPool().query<ResultSetHeader>(
    `UPDATE stations
     SET billing_interval = ?,
         plan_expires_at = ?,
         plan_code = ?
     WHERE id = ?`,
    [interval, expiry.expiresAt, interval === 'yearly' ? 'pro_yearly' : 'pro_monthly', id],
  )

  const full = await loadStation(id)
  res.json({ station: mapStation(full!) })
})

adminRouter.post('/stations/:id/suspend', async (req, res) => {
  const id = String(req.params.id ?? '')
  if (!id) {
    res.status(400).json({ error: 'validation_error', message: 'Station id required' })
    return
  }
  if (id === PLATFORM_STATION_ID) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Cannot suspend the platform ops station',
    })
    return
  }

  const existing = await loadStation(id)
  if (!existing) {
    notFound(res, 'Station')
    return
  }
  if (existing.plan_status === 'suspended') {
    res.json({ station: mapStation(existing) })
    return
  }

  await getPool().query<ResultSetHeader>(
    `UPDATE stations
     SET previous_plan_status = plan_status, plan_status = 'suspended'
     WHERE id = ?`,
    [id],
  )

  const full = await loadStation(id)
  res.json({ station: mapStation(full!) })
})

adminRouter.post('/stations/:id/unsuspend', async (req, res) => {
  const id = String(req.params.id ?? '')
  if (!id) {
    res.status(400).json({ error: 'validation_error', message: 'Station id required' })
    return
  }

  const existing = await loadStation(id)
  if (!existing) {
    notFound(res, 'Station')
    return
  }
  if (existing.plan_status !== 'suspended') {
    res.json({ station: mapStation(existing) })
    return
  }

  const restored = planStatusAfterUnsuspend(
    existing.previous_plan_status ? String(existing.previous_plan_status) : null,
  )
  await getPool().query<ResultSetHeader>(
    `UPDATE stations
     SET plan_status = ?, previous_plan_status = NULL
     WHERE id = ?`,
    [restored, id],
  )

  const full = await loadStation(id)
  res.json({ station: mapStation(full!) })
})
