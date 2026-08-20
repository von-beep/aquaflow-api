import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { completeOrderDeliveriesDb } from '../domain/orderGroup.js'
import { getPool } from '../db/pool.js'
import { manilaDateTimeToIso, toDateOnlyString } from '../lib/dates.js'
import { badRequest, notFound, stationId } from '../lib/http.js'
import { paymentProofPublicPath } from '../lib/paymentProof.js'
import { requireRider } from '../middleware/auth.js'

type StopRow = RowDataPacket & {
  id: string
  order_id: string
  delivery_date: string
  delivery_time: string
  customer_id: string
  rider_id: string | null
  prod_id: string
  prod_name: string | null
  qty: number
  amount: number
  status: string
  paid: number
  pay_mode: string
  note: string
  payment_proof_path: string | null
  completed_at: Date | string | null
  customer_name: string | null
  customer_phone: string | null
  customer_addr: string | null
  customer_note: string | null
}

/** Consumer landmark / note from delivery note (strips Online order + pay refs). */
function landmarkFromDeliveryNote(note: string): string {
  if (!note?.trim()) return ''
  return note
    .split('—')
    .map((s) => s.trim())
    .filter((part) => {
      if (!part) return false
      if (/^online order$/i.test(part)) return false
      if (/^(gcash|maya)\s*ref\b/i.test(part)) return false
      return true
    })
    .join(' — ')
}

function mapLine(r: StopRow) {
  const deliveryLandmark = landmarkFromDeliveryNote(r.note ?? '')
  const customerLandmark = (r.customer_note ?? '').trim()
  return {
    id: r.id,
    orderId: r.order_id || r.id,
    date: toDateOnlyString(r.delivery_date) ?? '',
    time: r.delivery_time,
    customerId: r.customer_id,
    customerName: r.customer_name ?? '',
    customerPhone: r.customer_phone ?? '',
    customerAddr: r.customer_addr ?? '',
    landmark: deliveryLandmark || customerLandmark || '',
    riderId: r.rider_id ?? '',
    prodId: r.prod_id,
    productName: r.prod_name?.trim() || r.prod_id,
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

export const riderAppRouter = Router()
riderAppRouter.use(requireRider)

riderAppRouter.get('/me', async (req, res) => {
  const sid = stationId(req)
  const riderId = req.auth!.riderId!
  const pool = getPool()
  const [riderRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, phone FROM riders
     WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1`,
    [riderId, sid],
  )
  const rider = (riderRows as RowDataPacket[])[0]
  if (!rider) {
    notFound(res, 'Rider')
    return
  }
  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT email FROM users WHERE id = ? AND station_id = ? LIMIT 1`,
    [req.auth!.id, sid],
  )
  const [stationRows] = await pool.query<RowDataPacket[]>(
    `SELECT name FROM stations WHERE id = ? LIMIT 1`,
    [sid],
  )
  res.json({
    user: {
      id: req.auth!.id,
      email: String((userRows as RowDataPacket[])[0]?.email ?? ''),
      role: 'rider' as const,
      stationId: sid,
      riderId,
    },
    rider: {
      id: String(rider.id),
      name: String(rider.name),
      phone: String(rider.phone ?? ''),
    },
    station: {
      id: sid,
      name: String((stationRows as RowDataPacket[])[0]?.name ?? ''),
    },
  })
})

/** Assigned stops for a day (default: today Manila / server date). */
riderAppRouter.get('/deliveries', async (req, res) => {
  const sid = stationId(req)
  const riderId = req.auth!.riderId!
  const dateRaw = typeof req.query.date === 'string' ? req.query.date.trim() : ''
  const date =
    dateRaw ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

  const [rows] = await getPool().query<StopRow[]>(
    `SELECT d.id, d.order_id, d.delivery_date, d.delivery_time, d.customer_id, d.rider_id,
            d.prod_id, p.name AS prod_name, d.qty, d.amount, d.status, d.paid, d.pay_mode,
            d.note, d.payment_proof_path, d.completed_at,
            c.name AS customer_name, c.phone AS customer_phone, c.addr AS customer_addr,
            c.note AS customer_note
     FROM deliveries d
     LEFT JOIN customers c ON c.id = d.customer_id AND c.station_id = d.station_id
     LEFT JOIN products p ON p.id = d.prod_id AND p.station_id = d.station_id
     WHERE d.station_id = ? AND d.rider_id = ? AND d.deleted_at IS NULL
       AND d.delivery_date = ?
     ORDER BY d.delivery_time DESC, d.order_id DESC, d.id DESC`,
    [sid, riderId, date],
  )

  const lines = (rows as StopRow[]).map(mapLine)
  const byOrder = new Map<
    string,
    {
      orderId: string
      date: string
      time: string
      customerId: string
      customerName: string
      customerPhone: string
      customerAddr: string
      landmark: string
      status: string
      paid: boolean
      payMode: string
      paymentProofUrl: string | null
      note: string
      total: number
      lines: ReturnType<typeof mapLine>[]
    }
  >()

  for (const line of lines) {
    let g = byOrder.get(line.orderId)
    if (!g) {
      g = {
        orderId: line.orderId,
        date: line.date,
        time: line.time,
        customerId: line.customerId,
        customerName: line.customerName,
        customerPhone: line.customerPhone,
        customerAddr: line.customerAddr,
        landmark: line.landmark,
        status: line.status,
        paid: line.paid,
        payMode: line.payMode,
        paymentProofUrl: line.paymentProofUrl,
        note: line.note,
        total: 0,
        lines: [],
      }
      byOrder.set(line.orderId, g)
    }
    g.lines.push(line)
    g.total += line.amount
    if (line.paymentProofUrl) g.paymentProofUrl = line.paymentProofUrl
    if (!g.landmark && line.landmark) g.landmark = line.landmark
    // Worst open status for the group
    const rank = (s: string) =>
      s === 'Cancelled' ? 3 : s === 'Completed' ? 2 : s === 'In Progress' ? 0 : 1
    if (rank(line.status) < rank(g.status)) g.status = line.status
    if (!line.paid) g.paid = false
  }

  // Newest first (time / orderId Z→A); open stops above completed.
  const orders = [...byOrder.values()].sort((a, b) => {
    const aDone = a.status === 'Completed' || a.status === 'Cancelled' ? 1 : 0
    const bDone = b.status === 'Completed' || b.status === 'Cancelled' ? 1 : 0
    if (aDone !== bDone) return aDone - bDone
    const byTime = b.time.localeCompare(a.time)
    if (byTime !== 0) return byTime
    return b.orderId.localeCompare(a.orderId)
  })

  res.json({
    date,
    orders,
  })
})

riderAppRouter.patch('/orders/:orderId', async (req, res) => {
  const sid = stationId(req)
  const riderId = req.auth!.riderId!
  const orderId = String(req.params.orderId ?? '').trim()
  const status = typeof req.body?.status === 'string' ? req.body.status.trim() : ''
  if (!orderId) {
    badRequest(res, 'orderId is required')
    return
  }
  if (status !== 'Pending' && status !== 'In Progress') {
    badRequest(res, 'status must be Pending or In Progress')
    return
  }

  const [owned] = await getPool().query<RowDataPacket[]>(
    `SELECT id FROM deliveries
     WHERE order_id = ? AND station_id = ? AND rider_id = ? AND deleted_at IS NULL
       AND status NOT IN ('Completed', 'Cancelled')
     LIMIT 1`,
    [orderId, sid, riderId],
  )
  if (!(owned as RowDataPacket[]).length) {
    notFound(res, 'Order')
    return
  }

  await getPool().query(
    `UPDATE deliveries SET status = ?, updated_at = UTC_TIMESTAMP(3)
     WHERE order_id = ? AND station_id = ? AND rider_id = ? AND deleted_at IS NULL
       AND status NOT IN ('Completed', 'Cancelled')`,
    [status, orderId, sid, riderId],
  )
  res.json({ orderId, status })
})

riderAppRouter.post('/orders/:orderId/complete', async (req, res) => {
  const sid = stationId(req)
  const riderId = req.auth!.riderId!
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

  const [lines] = await getPool().query<RowDataPacket[]>(
    `SELECT id, pay_mode, rider_id, status
     FROM deliveries
     WHERE order_id = ? AND station_id = ? AND deleted_at IS NULL`,
    [orderId, sid],
  )
  const all = lines as {
    id: string
    pay_mode: string
    rider_id: string | null
    status: string
  }[]
  if (!all.length) {
    notFound(res, 'Order')
    return
  }

  const open = all.filter((l) => l.status !== 'Completed' && l.status !== 'Cancelled')
  if (open.length && open.some((l) => l.rider_id !== riderId)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'This order is not assigned to you',
    })
    return
  }

  const payMode = open[0]?.pay_mode || all[0]?.pay_mode || ''
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

  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const result = await completeOrderDeliveriesDb(conn, sid, orderId, {
      payment,
      productNames: {},
    })
    if (!result) {
      await conn.rollback()
      notFound(res, 'Order')
      return
    }
    await conn.commit()
    res.json({ orderId, toast: result.toast, completed: result.completed })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})
