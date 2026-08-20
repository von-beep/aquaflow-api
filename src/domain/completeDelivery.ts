import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { MANILA_NOW_SQL } from '../lib/dates.js'
import { uid } from '../lib/ids.js'

export type CompleteDeliveryInput = {
  deliveryId: string
  /** Cash / GCash / Maya / Utang, or a station online method name when prepaid. */
  payment: string
  fullOut: number
  emptyIn: number
  productName: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

type DeliveryRow = RowDataPacket & {
  id: string
  customer_id: string
  qty: number
  amount: number
  status: string
}

/** Completes a delivery within one station (matches frontend completeDelivery). */
export async function completeDeliveryDb(
  conn: PoolConnection,
  stationId: string,
  input: CompleteDeliveryInput,
): Promise<{ toast: string } | null> {
  const [rows] = await conn.query<DeliveryRow[]>(
    `SELECT id, customer_id, qty, amount, status
     FROM deliveries WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [input.deliveryId, stationId],
  )
  const delivery = (rows as DeliveryRow[])[0]
  if (!delivery) return null

  const out = Math.max(0, Number(input.fullOut) || 0)
  const inn = Math.max(0, Number(input.emptyIn) || 0)
  const paid = input.payment !== 'Utang'
  const payMode = input.payment === 'Utang' ? '' : input.payment

  await conn.query(
    `UPDATE deliveries
     SET status = 'Completed',
         paid = ?,
         pay_mode = ?,
         completed_at = ${MANILA_NOW_SQL},
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND station_id = ?`,
    [paid ? 1 : 0, payMode, input.deliveryId, stationId],
  )

  await conn.query(
    `UPDATE inventory
     SET full_count = GREATEST(0, full_count - ?),
         empty_count = empty_count + ?
     WHERE station_id = ?`,
    [out, inn, stationId],
  )

  await conn.query(
    `UPDATE customers
     SET gallons_out = GREATEST(0, gallons_out + ? - ?)
     WHERE id = ? AND station_id = ?`,
    [out, inn, delivery.customer_id, stationId],
  )

  let toast: string
  if (input.payment === 'Utang') {
    await conn.query(
      `INSERT INTO utang (id, station_id, ts, customer_id, amount, note, delivery_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uid(),
        stationId,
        today(),
        delivery.customer_id,
        delivery.amount,
        `${delivery.qty}x ${input.productName}`,
        delivery.id,
      ],
    )
    toast = 'Delivered ✓ Nailista sa utang'
  } else {
    toast = `Delivered + paid ✓ ${Number(delivery.amount).toFixed(2)}`
  }

  return { toast }
}
