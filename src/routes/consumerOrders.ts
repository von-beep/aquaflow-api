import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { manilaDateTimeToIso, toDateOnlyString } from '../lib/dates.js'
import { requireConsumerAuth } from '../middleware/auth.js'

type OrderRow = RowDataPacket & {
  id: string
  order_id: string
  station_id: string
  station_name: string
  station_slug: string
  delivery_date: string | Date
  delivery_time: string
  prod_id: string
  product_name: string | null
  qty: number
  amount: number
  status: string
  paid: number
  pay_mode: string
  note: string
  completed_at: Date | string | null
  currency: string | null
  rider_id: string | null
  rider_name: string | null
  rider_phone: string | null
}

const ORDER_SELECT = `SELECT d.id, d.order_id, d.station_id, s.name AS station_name, s.slug AS station_slug,
            d.delivery_date, d.delivery_time, d.prod_id, p.name AS product_name,
            d.qty, d.amount, d.status, d.paid, d.pay_mode, d.note, d.completed_at,
            st.currency, d.rider_id, r.name AS rider_name, r.phone AS rider_phone
     FROM deliveries d
     INNER JOIN stations s ON s.id = d.station_id
     LEFT JOIN products p ON p.id = d.prod_id AND p.station_id = d.station_id
     LEFT JOIN settings st ON st.station_id = d.station_id
     LEFT JOIN riders r ON r.id = d.rider_id AND r.station_id = d.station_id
       AND r.deleted_at IS NULL`

export const consumerOrdersRouter = Router()

consumerOrdersRouter.use(requireConsumerAuth)

/** All order lines for this shopper across stations. */
consumerOrdersRouter.get('/orders', async (req, res) => {
  const stationId =
    typeof req.query.stationId === 'string' ? req.query.stationId.trim() : ''

  const params: unknown[] = [req.consumer!.id]
  let stationFilter = ''
  if (stationId) {
    stationFilter = ' AND d.station_id = ?'
    params.push(stationId)
  }

  const [rows] = await getPool().query<OrderRow[]>(
    `${ORDER_SELECT}
     WHERE d.consumer_user_id = ?
       AND d.deleted_at IS NULL
       ${stationFilter}
     ORDER BY d.delivery_date DESC, d.delivery_time DESC, d.order_id DESC, d.id DESC`,
    params,
  )

  res.json({
    orders: (rows as OrderRow[]).map(mapOrder),
  })
})

/**
 * Cancel a checkout order (all Pending lines sharing order_id).
 * `:id` may be a delivery id or an order_id.
 */
consumerOrdersRouter.post('/orders/:id/cancel', async (req, res) => {
  const id = typeof req.params.id === 'string' ? req.params.id.trim() : ''
  if (!id) {
    res.status(400).json({ error: 'validation_error', message: 'Order id is required' })
    return
  }

  const reason =
    typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : ''
  if (!reason) {
    res.status(400).json({
      error: 'validation_error',
      message: 'A cancellation reason is required',
    })
    return
  }

  const consumerId = req.consumer!.id
  const pool = getPool()

  const [existingRows] = await pool.query<OrderRow[]>(
    `${ORDER_SELECT}
     WHERE d.consumer_user_id = ?
       AND d.deleted_at IS NULL
       AND (d.id = ? OR d.order_id = ?)
     ORDER BY d.id ASC`,
    [consumerId, id, id],
  )
  const lines = existingRows as OrderRow[]
  if (lines.length === 0) {
    res.status(404).json({ error: 'not_found', message: 'Order not found' })
    return
  }

  const orderId = lines[0]!.order_id || lines[0]!.id
  const group = lines.filter((l) => (l.order_id || l.id) === orderId)

  if (group.every((l) => l.status === 'Cancelled')) {
    res.json({
      orderId,
      orders: group.map(mapOrder),
    })
    return
  }
  if (group.some((l) => l.status === 'In Progress')) {
    res.status(409).json({
      error: 'conflict',
      message: 'Order is already in progress and cannot be cancelled',
    })
    return
  }
  if (group.some((l) => l.status === 'Completed')) {
    res.status(409).json({
      error: 'conflict',
      message: 'Completed orders cannot be cancelled',
    })
    return
  }
  if (!group.every((l) => l.status === 'Pending' || l.status === 'Cancelled')) {
    res.status(409).json({
      error: 'conflict',
      message: 'Only pending orders can be cancelled',
    })
    return
  }

  const cancelNote = `Cancelled by customer: ${reason}`
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const line of group) {
      if (line.status !== 'Pending') continue
      const prevNote = (line.note ?? '').trim()
      const nextNote = !prevNote
        ? cancelNote
        : prevNote.includes('Cancelled by customer')
          ? prevNote
          : `${prevNote} · ${cancelNote}`
      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE deliveries
         SET status = 'Cancelled',
             note = ?,
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?
           AND consumer_user_id = ?
           AND deleted_at IS NULL
           AND status = 'Pending'`,
        [nextNote, line.id, consumerId],
      )
      if (result.affectedRows === 0) {
        await conn.rollback()
        res.status(409).json({
          error: 'conflict',
          message: 'Order status changed and can no longer be cancelled',
        })
        return
      }
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  const [rows] = await pool.query<OrderRow[]>(
    `${ORDER_SELECT}
     WHERE d.order_id = ? AND d.consumer_user_id = ? AND d.deleted_at IS NULL
     ORDER BY d.id ASC`,
    [orderId, consumerId],
  )
  res.json({
    orderId,
    orders: (rows as OrderRow[]).map(mapOrder),
    order: mapOrder((rows as OrderRow[])[0]!),
  })
})

function mapOrder(r: OrderRow) {
  const riderName = r.rider_name?.trim() || null
  const riderPhone = r.rider_phone?.trim() || null
  return {
    id: r.id,
    orderId: r.order_id || r.id,
    stationId: r.station_id,
    stationName: r.station_name,
    stationSlug: r.station_slug,
    date: toDateOnlyString(r.delivery_date) ?? '',
    time: r.delivery_time ?? '',
    productId: r.prod_id,
    productName: r.product_name ?? 'Product',
    qty: Number(r.qty) || 1,
    amount: Number(r.amount) || 0,
    currency: r.currency?.trim() || '₱',
    status: r.status,
    paid: Boolean(r.paid),
    payMode: r.pay_mode ?? '',
    note: r.note ?? '',
    completedAt: manilaDateTimeToIso(r.completed_at),
    riderId: r.rider_id ?? null,
    riderName,
    riderPhone,
  }
}
