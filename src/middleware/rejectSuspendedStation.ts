import type { NextFunction, Request, Response } from 'express'
import type { RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { stationId } from '../lib/http.js'

/**
 * Reject API access for suspended tenants (covers lingering JWTs after suspend).
 * Sync already returns 402 via entitlement; this returns 403 for all /api routes.
 */
export async function rejectSuspendedStation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sid = stationId(req)
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT plan_status FROM stations WHERE id = ? LIMIT 1`,
      [sid],
    )
    const status = (rows as RowDataPacket[])[0]?.plan_status
    if (status === 'suspended') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Station is suspended',
      })
      return
    }
    next()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Station status check failed' })
  }
}
