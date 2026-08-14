import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { badRequest, notFound, stationId } from '../lib/http.js'

type UtangRow = RowDataPacket & {
  id: string
  ts: string | Date
  customer_id: string
  amount: number
  note: string
  delivery_id: string | null
}

function mapUtang(r: UtangRow) {
  const ts =
    typeof r.ts === 'string' ? r.ts.slice(0, 10) : new Date(r.ts).toISOString().slice(0, 10)
  return {
    id: r.id,
    ts,
    customerId: r.customer_id,
    amount: Number(r.amount),
    note: r.note,
    deliveryId: r.delivery_id ?? undefined,
  }
}

export const utangRouter = Router()

utangRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const customerId =
    typeof req.query.customerId === 'string' ? req.query.customerId : undefined
  const sql = customerId
    ? `SELECT id, ts, customer_id, amount, note, delivery_id
       FROM utang WHERE station_id = ? AND customer_id = ? AND deleted_at IS NULL ORDER BY ts DESC`
    : `SELECT id, ts, customer_id, amount, note, delivery_id
       FROM utang WHERE station_id = ? AND deleted_at IS NULL ORDER BY ts DESC`
  const params = customerId ? [sid, customerId] : [sid]
  const [rows] = await getPool().query<UtangRow[]>(sql, params)
  res.json({ utang: (rows as UtangRow[]).map(mapUtang) })
})

utangRouter.post('/', async (req, res) => {
  const sid = stationId(req)
  const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : ''
  const amount = Number(req.body?.amount)
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  const ts =
    typeof req.body?.ts === 'string'
      ? req.body.ts
      : new Date().toISOString().slice(0, 10)
  const deliveryId =
    typeof req.body?.deliveryId === 'string' ? req.body.deliveryId : null
  if (!customerId || !Number.isFinite(amount)) {
    badRequest(res, 'customerId and amount are required')
    return
  }
  const id = typeof req.body?.id === 'string' && req.body.id ? req.body.id : uid()
  await getPool().query(
    `INSERT INTO utang (id, station_id, ts, customer_id, amount, note, delivery_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, sid, ts, customerId, amount, note, deliveryId],
  )
  const [rows] = await getPool().query<UtangRow[]>(
    `SELECT id, ts, customer_id, amount, note, delivery_id FROM utang WHERE id = ? AND station_id = ?`,
    [id, sid],
  )
  res.status(201).json({ entry: mapUtang((rows as UtangRow[])[0]) })
})

utangRouter.put('/:id', async (req, res) => {
  const sid = stationId(req)
  const amount = Number(req.body?.amount)
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  const ts = typeof req.body?.ts === 'string' ? req.body.ts : ''
  if (!ts || !Number.isFinite(amount)) {
    badRequest(res, 'ts and amount are required')
    return
  }
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE utang SET ts = ?, amount = ?, note = ? WHERE id = ? AND station_id = ?`,
    [ts, amount, note, req.params.id, sid],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Utang entry')
    return
  }
  const [rows] = await getPool().query<UtangRow[]>(
    `SELECT id, ts, customer_id, amount, note, delivery_id FROM utang WHERE id = ? AND station_id = ?`,
    [req.params.id, sid],
  )
  res.json({ entry: mapUtang((rows as UtangRow[])[0]) })
})

utangRouter.delete('/:id', async (req, res) => {
  const sid = stationId(req)
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE utang SET deleted_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND station_id = ? AND deleted_at IS NULL`,
    [req.params.id, sid],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Utang entry')
    return
  }
  res.status(204).send()
})
