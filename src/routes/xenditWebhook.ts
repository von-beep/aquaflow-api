import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import {
  isStationEntitled,
  planOutcomeFromXenditEvent,
} from '../billing/entitlement.js'
import { verifyXenditCallbackToken } from '../billing/xendit.js'
import { getPool } from '../db/pool.js'
import { toDateOnlyString } from '../lib/dates.js'

type StationRow = RowDataPacket & {
  id: string
  plan_status: string
  trial_ends_at: Date | string | null
  xendit_plan_id: string | null
  xendit_checkout_ref: string | null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/** Extract event name + ids from varied Xendit webhook shapes. */
export function parseXenditWebhook(body: unknown): {
  event: string
  planId: string | null
  referenceId: string | null
  stationIdMeta: string | null
} {
  const root = asRecord(body) ?? {}
  const data = asRecord(root.data) ?? asRecord(root.payload) ?? root
  const meta = asRecord(data.metadata) ?? asRecord(root.metadata) ?? {}

  const event =
    pickString(root.event, root.type, root.event_name, data.event) ?? 'unknown'

  const planId = pickString(
    data.id,
    data.plan_id,
    data.recurring_plan_id,
    root.id,
    meta.plan_id,
  )

  const referenceId = pickString(
    data.reference_id,
    root.reference_id,
    data.external_id,
    meta.reference_id,
  )

  const stationIdMeta = pickString(meta.station_id, data.station_id)

  return { event, planId, referenceId, stationIdMeta }
}

async function findStation(params: {
  planId: string | null
  referenceId: string | null
  stationIdMeta: string | null
}): Promise<StationRow | null> {
  const pool = getPool()
  if (params.stationIdMeta) {
    const [rows] = await pool.query<StationRow[]>(
      `SELECT id, plan_status, trial_ends_at, xendit_plan_id, xendit_checkout_ref
       FROM stations WHERE id = ? LIMIT 1`,
      [params.stationIdMeta],
    )
    const row = (rows as StationRow[])[0]
    if (row) return row
  }
  if (params.planId) {
    const [rows] = await pool.query<StationRow[]>(
      `SELECT id, plan_status, trial_ends_at, xendit_plan_id, xendit_checkout_ref
       FROM stations WHERE xendit_plan_id = ? LIMIT 1`,
      [params.planId],
    )
    const row = (rows as StationRow[])[0]
    if (row) return row
  }
  if (params.referenceId) {
    const [rows] = await pool.query<StationRow[]>(
      `SELECT id, plan_status, trial_ends_at, xendit_plan_id, xendit_checkout_ref
       FROM stations WHERE xendit_checkout_ref = ? LIMIT 1`,
      [params.referenceId],
    )
    const row = (rows as StationRow[])[0]
    if (row) return row

    // reference_id format stationId:uid
    const stationFromRef = params.referenceId.split(':')[0]
    if (stationFromRef) {
      const [byId] = await pool.query<StationRow[]>(
        `SELECT id, plan_status, trial_ends_at, xendit_plan_id, xendit_checkout_ref
         FROM stations WHERE id = ? LIMIT 1`,
        [stationFromRef],
      )
      const row2 = (byId as StationRow[])[0]
      if (row2) return row2
    }
  }
  return null
}

export const xenditWebhookRouter = Router()

xenditWebhookRouter.post('/', async (req, res) => {
  const token = req.header('x-callback-token') ?? undefined
  if (!verifyXenditCallbackToken(token)) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid Xendit callback token' })
    return
  }

  const parsed = parseXenditWebhook(req.body)
  const outcome = planOutcomeFromXenditEvent(parsed.event)
  if (outcome === 'ignore') {
    res.json({ ok: true, ignored: true, event: parsed.event })
    return
  }

  const station = await findStation(parsed)
  if (!station) {
    console.warn('Xendit webhook: station not found', parsed)
    res.json({ ok: true, unmatched: true, event: parsed.event })
    return
  }

  const trialEndsAt = toDateOnlyString(station.trial_ends_at)

  if (outcome === 'activate') {
    await getPool().query<ResultSetHeader>(
      `UPDATE stations
       SET plan_status = 'active',
           xendit_plan_id = COALESCE(?, xendit_plan_id)
       WHERE id = ?`,
      [parsed.planId, station.id],
    )
  } else {
    const stillTrial = isStationEntitled({ planStatus: 'trial', trialEndsAt })
    const next = stillTrial ? 'trial' : 'suspended'
    await getPool().query<ResultSetHeader>(
      `UPDATE stations
       SET plan_status = ?, xendit_plan_id = NULL
       WHERE id = ?`,
      [next, station.id],
    )
  }

  res.json({ ok: true, stationId: station.id, outcome, event: parsed.event })
})
