import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { badRequest, stationId } from '../lib/http.js'

type InvRow = RowDataPacket & { full_count: number; empty_count: number }

function mapInv(r: InvRow | undefined) {
  return {
    full: Number(r?.full_count ?? 0),
    empty: Number(r?.empty_count ?? 0),
  }
}

export const inventoryRouter = Router()

inventoryRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<InvRow[]>(
    'SELECT full_count, empty_count FROM inventory WHERE station_id = ? LIMIT 1',
    [sid],
  )
  res.json({ inventory: mapInv((rows as InvRow[])[0]) })
})

/** Set absolute counts. */
inventoryRouter.put('/', async (req, res) => {
  const sid = stationId(req)
  const full = Number(req.body?.full)
  const empty = Number(req.body?.empty)
  if (!Number.isFinite(full) || !Number.isFinite(empty) || full < 0 || empty < 0) {
    badRequest(res, 'full and empty must be non-negative numbers')
    return
  }
  await getPool().query<ResultSetHeader>(
    `INSERT INTO inventory (station_id, full_count, empty_count)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE full_count = VALUES(full_count), empty_count = VALUES(empty_count)`,
    [sid, full, empty],
  )
  res.json({ inventory: { full, empty } })
})

/** Refill: move empties → full (or adjust by deltas). */
inventoryRouter.post('/refill', async (req, res) => {
  const sid = stationId(req)
  const count = Number(req.body?.count)
  if (!Number.isFinite(count) || count <= 0) {
    badRequest(res, 'count must be a positive number')
    return
  }
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query<InvRow[]>(
      'SELECT full_count, empty_count FROM inventory WHERE station_id = ? LIMIT 1 FOR UPDATE',
      [sid],
    )
    let inv = mapInv((rows as InvRow[])[0])
    const move = Math.min(count, inv.empty)
    inv = { full: inv.full + move, empty: inv.empty - move }
    await conn.query(
      `INSERT INTO inventory (station_id, full_count, empty_count)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE full_count = VALUES(full_count), empty_count = VALUES(empty_count)`,
      [sid, inv.full, inv.empty],
    )
    await conn.commit()
    res.json({ inventory: inv, refilled: move })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})

inventoryRouter.post('/adjust', async (req, res) => {
  const sid = stationId(req)
  const fullDelta = Number(req.body?.fullDelta ?? 0)
  const emptyDelta = Number(req.body?.emptyDelta ?? 0)
  if (!Number.isFinite(fullDelta) || !Number.isFinite(emptyDelta)) {
    badRequest(res, 'fullDelta and emptyDelta must be numbers')
    return
  }
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query<InvRow[]>(
      'SELECT full_count, empty_count FROM inventory WHERE station_id = ? LIMIT 1 FOR UPDATE',
      [sid],
    )
    const cur = mapInv((rows as InvRow[])[0])
    const next = {
      full: Math.max(0, cur.full + fullDelta),
      empty: Math.max(0, cur.empty + emptyDelta),
    }
    await conn.query(
      `INSERT INTO inventory (station_id, full_count, empty_count)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE full_count = VALUES(full_count), empty_count = VALUES(empty_count)`,
      [sid, next.full, next.empty],
    )
    await conn.commit()
    res.json({ inventory: next })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})
