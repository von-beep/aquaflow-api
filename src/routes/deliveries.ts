import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { completeDeliveryDb } from '../domain/completeDelivery.js'
import {
  completeOrderDeliveriesDb,
  patchOrderDeliveriesDb,
} from '../domain/orderGroup.js'
import { recordWalkInSaleDb } from '../domain/walkInSale.js'
import { getPool } from '../db/pool.js'
import { manilaDateTimeToIso, toDateOnlyString } from '../lib/dates.js'
import { uid } from '../lib/ids.js'
import { badRequest, notFound, stationId } from '../lib/http.js'
import { paymentProofPublicPath } from '../lib/paymentProof.js'

const STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled'] as const

const DELIVERY_SELECT = `id, order_id, delivery_date, delivery_time, customer_id, rider_id, prod_id,
            qty, amount, status, paid, pay_mode, note, payment_proof_path, completed_at`

type DeliveryRow = RowDataPacket & {
  id: string
  order_id: string
  delivery_date: string
  delivery_time: string
  customer_id: string
  rider_id: string | null
  prod_id: string
  qty: number
  amount: number
  status: string
  paid: number
  pay_mode: string
  note: string
  payment_proof_path: string | null
  completed_at: Date | string | null
}

function normalizeRiderId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function mapDelivery(r: DeliveryRow) {
  const date = toDateOnlyString(r.delivery_date) ?? ''
  return {
    id: r.id,
    orderId: r.order_id || r.id,
    date,
    time: r.delivery_time,
    customerId: r.customer_id,
    riderId: r.rider_id ?? '',
    prodId: r.prod_id,
    qty: Number(r.qty),
    amount: Number(r.amount),
    status: r.status,
    paid: Boolean(r.paid),
    payMode: r.pay_mode,
    note: r.note,
    paymentProofUrl: paymentProofPublicPath(r.payment_proof_path),
    completedAt: manilaDateTimeToIso(r.completed_at),
  }
}

export const deliveriesRouter = Router()

deliveriesRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<DeliveryRow[]>(
    `SELECT ${DELIVERY_SELECT}
     FROM deliveries WHERE station_id = ? AND deleted_at IS NULL
     ORDER BY delivery_date DESC, delivery_time DESC`,
    [sid],
  )
  res.json({ deliveries: (rows as DeliveryRow[]).map(mapDelivery) })
})

/** Counter / walk-in refill: create order with product, complete immediately. */
deliveriesRouter.post('/walk-in', async (req, res) => {
  const sid = stationId(req)
  const productId = typeof req.body?.productId === 'string' ? req.body.productId.trim() : ''
  const qty = Number(req.body?.qty ?? 1)
  const payment = req.body?.payment
  const fullOut = Number(req.body?.fullOut)
  const emptyIn = Number(req.body?.emptyIn)
  const customerId =
    typeof req.body?.customerId === 'string' && req.body.customerId.trim()
      ? req.body.customerId.trim()
      : null
  const note = typeof req.body?.note === 'string' ? req.body.note : undefined

  if (!productId) {
    badRequest(res, 'productId is required')
    return
  }
  if (payment !== 'Cash' && payment !== 'GCash' && payment !== 'Maya' && payment !== 'Utang') {
    badRequest(res, 'payment must be Cash, GCash, Maya, or Utang')
    return
  }
  if (!Number.isFinite(fullOut) || !Number.isFinite(emptyIn)) {
    badRequest(res, 'fullOut and emptyIn are required')
    return
  }

  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const result = await recordWalkInSaleDb(conn, sid, {
      productId,
      qty,
      payment,
      fullOut,
      emptyIn,
      customerId,
      note,
    })
    if ('error' in result) {
      await conn.rollback()
      badRequest(res, result.error)
      return
    }
    await conn.commit()
    const [rows] = await getPool().query<DeliveryRow[]>(
      `SELECT ${DELIVERY_SELECT}
       FROM deliveries WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1`,
      [result.deliveryId, sid],
    )
    res.status(201).json({
      delivery: mapDelivery((rows as DeliveryRow[])[0]),
      toast: result.toast,
    })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})

deliveriesRouter.get('/:id', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<DeliveryRow[]>(
    `SELECT ${DELIVERY_SELECT}
     FROM deliveries WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1`,
    [req.params.id, sid],
  )
  const row = (rows as DeliveryRow[])[0]
  if (!row) {
    notFound(res, 'Delivery')
    return
  }
  res.json({ delivery: mapDelivery(row) })
})

deliveriesRouter.post('/', async (req, res) => {
  const sid = stationId(req)
  const date = typeof req.body?.date === 'string' ? req.body.date : ''
  const time = typeof req.body?.time === 'string' ? req.body.time : ''
  const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : ''
  const riderId = normalizeRiderId(req.body?.riderId)
  const prodId = typeof req.body?.prodId === 'string' ? req.body.prodId : ''
  const qty = Number(req.body?.qty ?? 1)
  const amount = Number(req.body?.amount)
  const status = typeof req.body?.status === 'string' ? req.body.status : 'Pending'
  const note = typeof req.body?.note === 'string' ? req.body.note : ''

  if (!date || !customerId || !prodId || !Number.isFinite(amount)) {
    badRequest(res, 'date, customerId, prodId, and amount are required')
    return
  }
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    badRequest(res, 'invalid status')
    return
  }

  const id = typeof req.body?.id === 'string' && req.body.id ? req.body.id : uid()
  const orderId =
    typeof req.body?.orderId === 'string' && req.body.orderId.trim()
      ? req.body.orderId.trim()
      : id
  await getPool().query(
    `INSERT INTO deliveries
      (id, order_id, station_id, delivery_date, delivery_time, customer_id, rider_id, prod_id,
       qty, amount, status, paid, pay_mode, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)`,
    [id, orderId, sid, date, time, customerId, riderId, prodId, qty, amount, status, note],
  )
  const [rows] = await getPool().query<DeliveryRow[]>(
    `SELECT ${DELIVERY_SELECT}
     FROM deliveries WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id, sid],
  )
  res.status(201).json({ delivery: mapDelivery((rows as DeliveryRow[])[0]) })
})

deliveriesRouter.put('/:id', async (req, res) => {
  const sid = stationId(req)
  const date = typeof req.body?.date === 'string' ? req.body.date : ''
  const time = typeof req.body?.time === 'string' ? req.body.time : ''
  const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : ''
  const riderId = normalizeRiderId(req.body?.riderId)
  const prodId = typeof req.body?.prodId === 'string' ? req.body.prodId : ''
  const qty = Number(req.body?.qty ?? 1)
  const amount = Number(req.body?.amount)
  const status = typeof req.body?.status === 'string' ? req.body.status : 'Pending'
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  const paid = Boolean(req.body?.paid)
  const payMode = typeof req.body?.payMode === 'string' ? req.body.payMode : ''

  if (!date || !customerId || !prodId || !Number.isFinite(amount)) {
    badRequest(res, 'date, customerId, prodId, and amount are required')
    return
  }
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    badRequest(res, 'invalid status')
    return
  }

  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE deliveries SET
      delivery_date = ?, delivery_time = ?, customer_id = ?, rider_id = ?, prod_id = ?,
      qty = ?, amount = ?, status = ?, paid = ?, pay_mode = ?, note = ?,
      updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND station_id = ? AND deleted_at IS NULL`,
    [
      date,
      time,
      customerId,
      riderId,
      prodId,
      qty,
      amount,
      status,
      paid ? 1 : 0,
      payMode,
      note,
      req.params.id,
      sid,
    ],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Delivery')
    return
  }
  const [rows] = await getPool().query<DeliveryRow[]>(
    `SELECT ${DELIVERY_SELECT}
     FROM deliveries WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1`,
    [req.params.id, sid],
  )
  res.json({ delivery: mapDelivery((rows as DeliveryRow[])[0]) })
})

/** Group update: rider / status for every line in a checkout order. */
deliveriesRouter.patch('/orders/:orderId', async (req, res) => {
  const sid = stationId(req)
  const orderId = String(req.params.orderId ?? '').trim()
  if (!orderId) {
    badRequest(res, 'orderId is required')
    return
  }

  const patch: { status?: string; riderId?: string | null } = {}
  if ('status' in (req.body ?? {})) {
    patch.status = typeof req.body?.status === 'string' ? req.body.status : ''
  }
  if ('riderId' in (req.body ?? {})) {
    patch.riderId = normalizeRiderId(req.body?.riderId)
  }
  if (patch.status === undefined && patch.riderId === undefined) {
    badRequest(res, 'status or riderId is required')
    return
  }

  try {
    const affected = await patchOrderDeliveriesDb(getPool(), sid, orderId, patch)
    if (affected === 0) {
      notFound(res, 'Order')
      return
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'invalid_status') {
      badRequest(res, 'invalid status')
      return
    }
    if (err instanceof Error && err.message === 'use_complete') {
      badRequest(res, 'Use Finish Transaction to complete an order')
      return
    }
    throw err
  }

  const [rows] = await getPool().query<DeliveryRow[]>(
    `SELECT ${DELIVERY_SELECT}
     FROM deliveries WHERE order_id = ? AND station_id = ? AND deleted_at IS NULL
     ORDER BY id ASC`,
    [orderId, sid],
  )
  res.json({
    orderId,
    deliveries: (rows as DeliveryRow[]).map(mapDelivery),
  })
})

/** Complete all open lines in a checkout order (one payment). */
deliveriesRouter.post('/orders/:orderId/complete', async (req, res) => {
  const sid = stationId(req)
  const orderId = String(req.params.orderId ?? '').trim()
  const payment =
    typeof req.body?.payment === 'string' ? req.body.payment.trim().slice(0, 32) : ''
  if (!orderId) {
    badRequest(res, 'orderId is required')
    return
  }
  if (!payment) {
    badRequest(res, 'payment is required')
    return
  }

  const [modeRows] = await getPool().query<RowDataPacket[]>(
    `SELECT pay_mode FROM deliveries
     WHERE order_id = ? AND station_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [orderId, sid],
  )
  const payMode = String((modeRows as RowDataPacket[])[0]?.pay_mode ?? '')
  const prepaid = Boolean(payMode) && payMode !== 'Cash'
  if (prepaid) {
    if (payment !== payMode) {
      badRequest(res, `This order was prepaid with ${payMode}`)
      return
    }
  } else if (
    payment !== 'Cash' &&
    payment !== 'GCash' &&
    payment !== 'Maya' &&
    payment !== 'Utang'
  ) {
    badRequest(res, 'payment must be Cash, GCash, Maya, or Utang')
    return
  }

  const productNames: Record<string, string> =
    req.body?.productNames && typeof req.body.productNames === 'object'
      ? (req.body.productNames as Record<string, string>)
      : {}

  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const result = await completeOrderDeliveriesDb(conn, sid, orderId, {
      payment,
      productNames,
    })
    if (!result) {
      await conn.rollback()
      notFound(res, 'Order')
      return
    }
    await conn.commit()
    const [rows] = await getPool().query<DeliveryRow[]>(
      `SELECT ${DELIVERY_SELECT}
       FROM deliveries WHERE order_id = ? AND station_id = ? AND deleted_at IS NULL
       ORDER BY id ASC`,
      [orderId, sid],
    )
    res.json({
      orderId,
      deliveries: (rows as DeliveryRow[]).map(mapDelivery),
      toast: result.toast,
    })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})

/** Partial update for inline table edits (status / rider). */
deliveriesRouter.patch('/:id', async (req, res) => {
  const sid = stationId(req)
  const sets: string[] = []
  const params: unknown[] = []

  if ('status' in (req.body ?? {})) {
    const status = typeof req.body?.status === 'string' ? req.body.status : ''
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
      badRequest(res, 'invalid status')
      return
    }
    sets.push('status = ?')
    params.push(status)
  }

  if ('riderId' in (req.body ?? {})) {
    sets.push('rider_id = ?')
    params.push(normalizeRiderId(req.body?.riderId))
  }

  if (sets.length === 0) {
    badRequest(res, 'status or riderId is required')
    return
  }

  sets.push('updated_at = UTC_TIMESTAMP(3)')
  params.push(req.params.id, sid)

  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE deliveries SET ${sets.join(', ')}
     WHERE id = ? AND station_id = ? AND deleted_at IS NULL`,
    params,
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Delivery')
    return
  }
  const [rows] = await getPool().query<DeliveryRow[]>(
    `SELECT ${DELIVERY_SELECT}
     FROM deliveries WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1`,
    [req.params.id, sid],
  )
  res.json({ delivery: mapDelivery((rows as DeliveryRow[])[0]) })
})

deliveriesRouter.delete('/:id', async (req, res) => {
  const sid = stationId(req)
  // Hard delete — utang.delivery_id is ON DELETE SET NULL.
  const [result] = await getPool().query<ResultSetHeader>(
    `DELETE FROM deliveries WHERE id = ? AND station_id = ?`,
    [req.params.id, sid],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Delivery')
    return
  }
  res.status(204).send()
})

deliveriesRouter.post('/:id/complete', async (req, res) => {
  const sid = stationId(req)
  const payment = req.body?.payment
  const fullOut = Number(req.body?.fullOut)
  const emptyIn = Number(req.body?.emptyIn)
  const productName =
    typeof req.body?.productName === 'string' ? req.body.productName.trim() : ''

  if (payment !== 'Cash' && payment !== 'GCash' && payment !== 'Maya' && payment !== 'Utang') {
    badRequest(res, 'payment must be Cash, GCash, Maya, or Utang')
    return
  }
  if (!Number.isFinite(fullOut) || !Number.isFinite(emptyIn) || !productName) {
    badRequest(res, 'fullOut, emptyIn, and productName are required')
    return
  }

  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const result = await completeDeliveryDb(conn, sid, {
      deliveryId: req.params.id,
      payment,
      fullOut,
      emptyIn,
      productName,
    })
    if (!result) {
      await conn.rollback()
      notFound(res, 'Delivery')
      return
    }
    await conn.commit()
    const [rows] = await getPool().query<DeliveryRow[]>(
      `SELECT ${DELIVERY_SELECT}
       FROM deliveries WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.params.id, sid],
    )
    res.json({ delivery: mapDelivery((rows as DeliveryRow[])[0]), toast: result.toast })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})
