import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { completeDeliveryDb } from './completeDelivery.js'
import { nowTimeInManila, todayInManila } from '../lib/dates.js'
import { uid } from '../lib/ids.js'

const WALK_IN_NAME = 'Walk-in'

export type WalkInSaleInput = {
  productId: string
  qty: number
  payment: 'Cash' | 'GCash' | 'Maya' | 'Utang'
  fullOut: number
  emptyIn: number
  /** Required when payment is Utang; otherwise defaults to station Walk-in customer. */
  customerId?: string | null
  note?: string
}

async function ensureWalkInCustomer(
  conn: PoolConnection,
  stationId: string,
): Promise<string> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM customers
     WHERE station_id = ? AND name = ? AND deleted_at IS NULL
     LIMIT 1`,
    [stationId, WALK_IN_NAME],
  )
  const existing = (rows as { id: string }[])[0]?.id
  if (existing) return existing

  const id = uid()
  await conn.query(
    `INSERT INTO customers (id, station_id, name, phone, addr, gallons_out, note)
     VALUES (?, ?, ?, '', '', 0, ?)`,
    [id, stationId, WALK_IN_NAME, 'Counter / walk-in sales'],
  )
  return id
}

/**
 * Creates a Pending delivery then completes it (inventory + sales + optional utang).
 * Product is stored on the delivery for reporting.
 */
export async function recordWalkInSaleDb(
  conn: PoolConnection,
  stationId: string,
  input: WalkInSaleInput,
): Promise<{ deliveryId: string; toast: string; amount: number } | { error: string }> {
  const qty = Math.max(1, Math.floor(Number(input.qty) || 0))
  if (!Number.isFinite(qty) || qty < 1) {
    return { error: 'qty must be at least 1' }
  }

  const [prodRows] = await conn.query<RowDataPacket[]>(
    `SELECT id, name, price FROM products
     WHERE id = ? AND station_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [input.productId, stationId],
  )
  const product = (prodRows as { id: string; name: string; price: number }[])[0]
  if (!product) {
    return { error: 'Product not found' }
  }

  let customerId =
    typeof input.customerId === 'string' && input.customerId.trim()
      ? input.customerId.trim()
      : ''

  if (input.payment === 'Utang' && !customerId) {
    return { error: 'Customer is required for Utang walk-in sales' }
  }

  if (!customerId) {
    customerId = await ensureWalkInCustomer(conn, stationId)
  } else {
    const [custRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, name FROM customers
       WHERE id = ? AND station_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [customerId, stationId],
    )
    const cust = (custRows as { id: string; name: string }[])[0]
    if (!cust) {
      return { error: 'Customer not found' }
    }
    if (input.payment === 'Utang' && cust.name === WALK_IN_NAME) {
      return { error: 'Select a customer for Utang (not Walk-in)' }
    }
  }

  const amount = Number(product.price) * qty
  const deliveryId = uid()
  const note =
    typeof input.note === 'string' && input.note.trim()
      ? input.note.trim().slice(0, 500)
      : 'Walk-in refill'

  await conn.query<ResultSetHeader>(
    `INSERT INTO deliveries
      (id, order_id, station_id, delivery_date, delivery_time, customer_id, rider_id, prod_id,
       qty, amount, status, paid, pay_mode, note)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'Pending', 0, '', ?)`,
    [
      deliveryId,
      deliveryId,
      stationId,
      todayInManila(),
      nowTimeInManila(),
      customerId,
      product.id,
      qty,
      amount,
      note,
    ],
  )

  const result = await completeDeliveryDb(conn, stationId, {
    deliveryId,
    payment: input.payment,
    fullOut: input.fullOut,
    emptyIn: input.emptyIn,
    productName: product.name,
  })
  if (!result) {
    return { error: 'Could not complete walk-in sale' }
  }

  const toast =
    input.payment === 'Utang'
      ? 'Walk-in ✓ Nailista sa utang'
      : `Walk-in sale ✓ ${amount.toFixed(2)}`

  return { deliveryId, toast, amount }
}
