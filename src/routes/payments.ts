import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { badRequest, notFound, stationId } from '../lib/http.js'

type PaymentRow = RowDataPacket & {
  id: string
  ts: string | Date
  customer_id: string
  amount: number
  note: string
  mode: 'Cash' | 'GCash'
}

function mapPayment(r: PaymentRow) {
  const ts =
    typeof r.ts === 'string' ? r.ts.slice(0, 10) : new Date(r.ts).toISOString().slice(0, 10)
  return {
    id: r.id,
    ts,
    customerId: r.customer_id,
    amount: Number(r.amount),
    note: r.note,
    mode: r.mode,
  }
}

export const paymentsRouter = Router()

paymentsRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const customerId =
    typeof req.query.customerId === 'string' ? req.query.customerId : undefined
  const sql = customerId
    ? `SELECT id, ts, customer_id, amount, note, mode
       FROM payments WHERE station_id = ? AND customer_id = ? AND deleted_at IS NULL ORDER BY ts DESC`
    : `SELECT id, ts, customer_id, amount, note, mode
       FROM payments WHERE station_id = ? AND deleted_at IS NULL ORDER BY ts DESC`
  const params = customerId ? [sid, customerId] : [sid]
  const [rows] = await getPool().query<PaymentRow[]>(sql, params)
  res.json({ payments: (rows as PaymentRow[]).map(mapPayment) })
})

paymentsRouter.post('/', async (req, res) => {
  const sid = stationId(req)
  const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : ''
  const amount = Number(req.body?.amount)
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  const mode = req.body?.mode
  const ts =
    typeof req.body?.ts === 'string'
      ? req.body.ts
      : new Date().toISOString().slice(0, 10)
  if (!customerId || !Number.isFinite(amount) || (mode !== 'Cash' && mode !== 'GCash')) {
    badRequest(res, 'customerId, amount, and mode (Cash|GCash) are required')
    return
  }
  const id = typeof req.body?.id === 'string' && req.body.id ? req.body.id : uid()
  await getPool().query(
    `INSERT INTO payments (id, station_id, ts, customer_id, amount, note, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, sid, ts, customerId, amount, note, mode],
  )
  const [rows] = await getPool().query<PaymentRow[]>(
    `SELECT id, ts, customer_id, amount, note, mode FROM payments WHERE id = ? AND station_id = ?`,
    [id, sid],
  )
  res.status(201).json({ payment: mapPayment((rows as PaymentRow[])[0]) })
})

paymentsRouter.put('/:id', async (req, res) => {
  const sid = stationId(req)
  const amount = Number(req.body?.amount)
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  const mode = req.body?.mode
  const ts = typeof req.body?.ts === 'string' ? req.body.ts : ''
  if (!ts || !Number.isFinite(amount) || (mode !== 'Cash' && mode !== 'GCash')) {
    badRequest(res, 'ts, amount, and mode (Cash|GCash) are required')
    return
  }
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE payments SET ts = ?, amount = ?, note = ?, mode = ?
     WHERE id = ? AND station_id = ?`,
    [ts, amount, note, mode, req.params.id, sid],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Payment')
    return
  }
  const [rows] = await getPool().query<PaymentRow[]>(
    `SELECT id, ts, customer_id, amount, note, mode FROM payments WHERE id = ? AND station_id = ?`,
    [req.params.id, sid],
  )
  res.json({ payment: mapPayment((rows as PaymentRow[])[0]) })
})

paymentsRouter.delete('/:id', async (req, res) => {
  const sid = stationId(req)
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE payments SET deleted_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND station_id = ? AND deleted_at IS NULL`,
    [req.params.id, sid],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Payment')
    return
  }
  res.status(204).send()
})
