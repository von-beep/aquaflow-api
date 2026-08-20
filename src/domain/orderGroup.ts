import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { completeDeliveryDb } from './completeDelivery.js'
import { uid } from '../lib/ids.js'

const STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled'] as const

type Db = Pool | PoolConnection

export async function patchOrderDeliveriesDb(
  conn: Db,
  stationId: string,
  orderId: string,
  patch: { status?: string; riderId?: string | null },
): Promise<number> {
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status as (typeof STATUSES)[number])) {
      throw new Error('invalid_status')
    }
    if (patch.status === 'Completed') {
      throw new Error('use_complete')
    }
    sets.push('status = ?')
    params.push(patch.status)
  }

  if (patch.riderId !== undefined) {
    sets.push('rider_id = ?')
    params.push(patch.riderId)
  }

  if (sets.length === 0) return 0

  sets.push('updated_at = UTC_TIMESTAMP(3)')
  params.push(orderId, stationId)

  const [result] = await conn.query<ResultSetHeader>(
    `UPDATE deliveries SET ${sets.join(', ')}
     WHERE order_id = ? AND station_id = ? AND deleted_at IS NULL
       AND status <> 'Completed'`,
    params,
  )
  return result.affectedRows
}

/** Complete every non-completed line in an order with the same payment. */
export async function completeOrderDeliveriesDb(
  conn: PoolConnection,
  stationId: string,
  orderId: string,
  input: {
    /** Cash / GCash / Maya / Utang, or prepaid online method name. */
    payment: string
    productNames: Record<string, string>
  },
): Promise<{ toast: string; completed: number } | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, prod_id, qty, amount, status
     FROM deliveries
     WHERE order_id = ? AND station_id = ? AND deleted_at IS NULL
     ORDER BY id ASC
     FOR UPDATE`,
    [orderId, stationId],
  )
  const lines = rows as {
    id: string
    prod_id: string
    qty: number
    amount: number
    status: string
  }[]
  if (lines.length === 0) return null

  const open = lines.filter(
    (l) => l.status !== 'Completed' && l.status !== 'Cancelled',
  )
  if (open.length === 0) {
    return { toast: 'Order already completed', completed: 0 }
  }

  let totalAmount = 0
  for (const line of open) {
    const productName =
      input.productNames[line.prod_id] ||
      input.productNames[line.id] ||
      'Product'
    const qty = Math.max(1, Number(line.qty) || 1)
    const result = await completeDeliveryDb(conn, stationId, {
      deliveryId: line.id,
      payment: input.payment,
      fullOut: qty,
      emptyIn: qty,
      productName,
    })
    if (!result) {
      throw new Error(`failed_complete:${line.id}`)
    }
    totalAmount += Number(line.amount) || 0
  }

  const toast =
    input.payment === 'Utang'
      ? `Order completed ✓ Nailista sa utang (${open.length} item${open.length > 1 ? 's' : ''})`
      : `Order completed + paid ✓ ${totalAmount.toFixed(2)} (${open.length} item${open.length > 1 ? 's' : ''})`

  return { toast, completed: open.length }
}

export function newOrderId(): string {
  return uid()
}
