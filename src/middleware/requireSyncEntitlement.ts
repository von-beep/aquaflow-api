import type { NextFunction, Request, Response } from 'express'
import type { RowDataPacket } from 'mysql2'
import { isStationEntitled } from '../billing/entitlement.js'
import { getPool } from '../db/pool.js'
import { toDateOnlyString } from '../lib/dates.js'
import { stationId } from '../lib/http.js'

type StationEntitlementRow = RowDataPacket & {
  plan_status: string
  trial_ends_at: Date | string | null
  plan_expires_at: Date | string | null
}

/**
 * Gate premium cloud sync: active subscription or unexpired trial.
 * Local app + JSON backup remain available without entitlement.
 */
export async function requireSyncEntitlement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sid = stationId(req)
    const [rows] = await getPool().query<StationEntitlementRow[]>(
      `SELECT plan_status, trial_ends_at, plan_expires_at FROM stations WHERE id = ? LIMIT 1`,
      [sid],
    )
    const row = (rows as StationEntitlementRow[])[0]
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Station not found' })
      return
    }
    const trialEndsAt = toDateOnlyString(row.trial_ends_at)
    const planExpiresAt = toDateOnlyString(row.plan_expires_at)
    if (
      !isStationEntitled({
        planStatus: row.plan_status,
        trialEndsAt,
        planExpiresAt,
      })
    ) {
      res.status(402).json({
        error: 'payment_required',
        message:
          'Cloud sync requires an active subscription or unexpired trial. Upgrade in Settings → Billing.',
        planStatus: row.plan_status,
        trialEndsAt,
        planExpiresAt,
      })
      return
    }
    next()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Entitlement check failed' })
  }
}
