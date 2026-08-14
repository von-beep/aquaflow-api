import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { toDateOnlyString } from '../lib/dates.js'
import { badRequest, stationId } from '../lib/http.js'
import { requireOwner } from '../middleware/requireOwner.js'

type StationRow = RowDataPacket & {
  id: string
  name: string
  slug: string
  phone: string
  address: string
  lat: number | string | null
  lng: number | string | null
  plan_status: string
  trial_ends_at: Date | string | null
}

function parseCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

function mapStation(r: StationRow) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    phone: r.phone ?? '',
    address: r.address ?? '',
    lat: parseCoord(r.lat),
    lng: parseCoord(r.lng),
    planStatus: r.plan_status,
    trialEndsAt: toDateOnlyString(r.trial_ends_at),
  }
}

const STATION_SELECT = `SELECT id, name, slug, phone, address, lat, lng, plan_status, trial_ends_at
     FROM stations WHERE id = ? LIMIT 1`

export const stationRouter = Router()

stationRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<StationRow[]>(STATION_SELECT, [sid])
  const row = (rows as StationRow[])[0]
  if (!row) {
    res.status(404).json({ error: 'not_found', message: 'Station not found' })
    return
  }
  res.json({ station: mapStation(row) })
})

/** Owner updates station profile (mirrors into settings for sync clients). */
stationRouter.patch('/', requireOwner, async (req, res) => {
  const sid = stationId(req)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
  const lat = parseCoord(req.body?.lat)
  const lng = parseCoord(req.body?.lng)
  if (!name) {
    badRequest(res, 'name is required')
    return
  }
  if ((lat == null) !== (lng == null)) {
    badRequest(res, 'lat and lng must both be set or both cleared')
    return
  }

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result] = await conn.query<ResultSetHeader>(
      `UPDATE stations SET name = ?, phone = ?, address = ?, lat = ?, lng = ? WHERE id = ?`,
      [name, phone, address, lat, lng, sid],
    )
    if (result.affectedRows === 0) {
      await conn.rollback()
      res.status(404).json({ error: 'not_found', message: 'Station not found' })
      return
    }
    await conn.query(
      `INSERT INTO settings (station_id, station_name, owner, phone, address, lat, lng, currency)
       VALUES (?, ?, '', ?, ?, ?, ?, '₱')
       ON DUPLICATE KEY UPDATE
         station_name = VALUES(station_name),
         phone = VALUES(phone),
         address = VALUES(address),
         lat = VALUES(lat),
         lng = VALUES(lng),
         updated_at = UTC_TIMESTAMP(3)`,
      [sid, name, phone, address, lat, lng],
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  const [rows] = await getPool().query<StationRow[]>(STATION_SELECT, [sid])
  res.json({ station: mapStation((rows as StationRow[])[0]) })
})
