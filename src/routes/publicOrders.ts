import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { nowTimeInManila, todayInManila } from '../lib/dates.js'
import { uid } from '../lib/ids.js'
import { newOrderId } from '../domain/orderGroup.js'
import { savePaymentProofDataUrl } from '../lib/paymentProof.js'
import { requireConsumerAuth } from '../middleware/auth.js'
import { PLATFORM_STATION_ID } from '../platform/planRestore.js'

type StationRow = RowDataPacket & {
  id: string
  name: string
  slug: string
}

type ProductRow = RowDataPacket & {
  id: string
  name: string
  price: number
}

type CustomerRow = RowDataPacket & {
  id: string
  name: string
  phone: string
  addr: string
}

type SettingsRow = RowDataPacket & {
  currency: string
}

type ConsumerRow = RowDataPacket & {
  id: string
  name: string
  phone: string
}

type LineInput = { productId: string; qty: number }

function parseItems(body: unknown): LineInput[] | { error: string } {
  const b = body as Record<string, unknown> | null
  if (Array.isArray(b?.items) && b.items.length > 0) {
    const items: LineInput[] = []
    for (const raw of b.items) {
      const row = raw as Record<string, unknown>
      const productId = typeof row?.productId === 'string' ? row.productId.trim() : ''
      const qty = Number(row?.qty ?? 1)
      if (!productId) return { error: 'Each item needs productId' }
      if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
        return { error: 'Each item qty must be a positive integer' }
      }
      items.push({ productId, qty })
    }
    // Merge duplicate product ids
    const merged = new Map<string, number>()
    for (const it of items) {
      merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.qty)
    }
    return [...merged.entries()].map(([productId, qty]) => ({ productId, qty }))
  }

  const productId = typeof b?.productId === 'string' ? b.productId.trim() : ''
  const qty = Number(b?.qty ?? 1)
  if (!productId) return { error: 'productId or items is required' }
  if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
    return { error: 'qty must be a positive integer' }
  }
  return [{ productId, qty }]
}

/**
 * Online orders from the marketing landing page (requires customer account).
 * Supports single product or multi-item checkout (shared order_id).
 */
export const publicOrdersRouter = Router()

publicOrdersRouter.post(
  '/stations/:idOrSlug/orders',
  requireConsumerAuth,
  async (req, res) => {
    const key = String(req.params.idOrSlug ?? '').trim()
    if (!key) {
      res.status(400).json({ error: 'bad_request', message: 'Station id or slug required' })
      return
    }

    const parsed = parseItems(req.body)
    if ('error' in parsed) {
      res.status(400).json({ error: 'bad_request', message: parsed.error })
      return
    }
    const items = parsed

    const customerName =
      typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : ''
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
    const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
    const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
    const payModeRaw =
      typeof req.body?.payMode === 'string' ? req.body.payMode.trim().slice(0, 32) : 'Cash'
    const paymentProof =
      typeof req.body?.paymentProof === 'string' ? req.body.paymentProof.trim() : ''
    // Legacy: old clients sent paymentReference; prefer screenshot when present.
    const paymentReference =
      typeof req.body?.paymentReference === 'string' ? req.body.paymentReference.trim() : ''

    if (!customerName || !phone || !address) {
      res.status(400).json({
        error: 'bad_request',
        message: 'customerName, phone, and address are required',
      })
      return
    }

    const pool = getPool()
    const conn = await pool.getConnection()
    try {
      const [consumerRows] = await conn.query<ConsumerRow[]>(
        `SELECT id, name, phone FROM consumer_users WHERE id = ? LIMIT 1`,
        [req.consumer!.id],
      )
      const consumer = (consumerRows as ConsumerRow[])[0]
      if (!consumer) {
        res.status(401).json({ error: 'unauthorized', message: 'Account not found' })
        return
      }

      const [stationRows] = await conn.query<StationRow[]>(
        `SELECT id, name, slug
         FROM stations
         WHERE (id = ? OR slug = ?)
           AND id <> ?
           AND plan_status <> 'suspended'
         LIMIT 1`,
        [key, key, PLATFORM_STATION_ID],
      )
      const station = (stationRows as StationRow[])[0]
      if (!station) {
        res.status(404).json({ error: 'not_found', message: 'Station not found' })
        return
      }

      let payMode = ''
      let needsProof = false
      if (payModeRaw === 'Cash' || payModeRaw === '') {
        payMode = 'Cash'
        needsProof = false
      } else {
        const [methodRows] = await conn.query<RowDataPacket[]>(
          `SELECT name FROM station_payment_methods
           WHERE station_id = ?
             AND name = ?
             AND qr_path IS NOT NULL
             AND qr_path <> ''
           LIMIT 1`,
          [station.id, payModeRaw],
        )
        const method = (methodRows as RowDataPacket[])[0]
        if (!method) {
          res.status(400).json({
            error: 'bad_request',
            message: 'payMode must be Cash or an available online payment method for this station',
          })
          return
        }
        payMode = String(method.name)
        needsProof = true
        if (!paymentProof && !paymentReference) {
          res.status(400).json({
            error: 'bad_request',
            message: `Payment screenshot is required for ${payMode}`,
          })
          return
        }
      }

      const products: ProductRow[] = []
      for (const item of items) {
        const [productRows] = await conn.query<ProductRow[]>(
          `SELECT id, name, price
           FROM products
           WHERE id = ? AND station_id = ? AND deleted_at IS NULL
           LIMIT 1`,
          [item.productId, station.id],
        )
        const product = (productRows as ProductRow[])[0]
        if (!product) {
          res.status(404).json({
            error: 'not_found',
            message: `Product not found: ${item.productId}`,
          })
          return
        }
        products.push(product)
      }

      const [settingsRows] = await conn.query<SettingsRow[]>(
        `SELECT currency FROM settings WHERE station_id = ? LIMIT 1`,
        [station.id],
      )
      const currency = (settingsRows as SettingsRow[])[0]?.currency?.trim() || '₱'

      await conn.beginTransaction()

      const [existingCustomers] = await conn.query<CustomerRow[]>(
        `SELECT id, name, phone, addr
         FROM customers
         WHERE station_id = ? AND phone = ? AND deleted_at IS NULL
         LIMIT 1`,
        [station.id, phone],
      )
      let customer = (existingCustomers as CustomerRow[])[0]
      if (customer) {
        await conn.query(
          `UPDATE customers SET name = ?, addr = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE id = ? AND station_id = ?`,
          [customerName, address, customer.id, station.id],
        )
      } else {
        const customerId = uid()
        await conn.query(
          `INSERT INTO customers (id, station_id, name, phone, addr, gallons_out, note)
           VALUES (?, ?, ?, ?, ?, 0, 'Online order')`,
          [customerId, station.id, customerName, phone, address],
        )
        customer = {
          id: customerId,
          name: customerName,
          phone,
          addr: address,
        } as CustomerRow
      }

      const orderId = newOrderId()
      const noteParts = ['Online order']
      if (needsProof && paymentReference && !paymentProof) {
        noteParts.push(`${payMode} ref: ${paymentReference}`)
      }
      if (noteRaw) noteParts.push(noteRaw)
      const deliveryNote = noteParts.join(' — ')

      let paymentProofPath: string | null = null
      if (needsProof && paymentProof) {
        try {
          paymentProofPath = await savePaymentProofDataUrl(
            station.id,
            orderId,
            paymentProof,
          )
        } catch (err) {
          const code = err instanceof Error ? err.message : ''
          if (code === 'image_too_large') {
            res.status(400).json({
              error: 'bad_request',
              message: 'Payment screenshot is too large (max ~900KB)',
            })
            return
          }
          res.status(400).json({
            error: 'bad_request',
            message: 'Invalid payment screenshot — use PNG, JPEG, or WebP',
          })
          return
        }
      }

      const date = todayInManila()
      const time = nowTimeInManila()

      const lines: {
        deliveryId: string
        productId: string
        productName: string
        qty: number
        amount: number
      }[] = []
      let totalAmount = 0

      for (let i = 0; i < items.length; i++) {
        const item = items[i]!
        const product = products[i]!
        const deliveryId = uid()
        const amount = Number(product.price) * item.qty
        totalAmount += amount
        await conn.query(
          `INSERT INTO deliveries
            (id, order_id, station_id, delivery_date, delivery_time, customer_id, consumer_user_id,
             rider_id, prod_id, qty, amount, status, paid, pay_mode, note, payment_proof_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'Pending', 0, ?, ?, ?)`,
          [
            deliveryId,
            orderId,
            station.id,
            date,
            time,
            customer.id,
            consumer.id,
            product.id,
            item.qty,
            amount,
            payMode,
            deliveryNote,
            paymentProofPath,
          ],
        )
        lines.push({
          deliveryId,
          productId: product.id,
          productName: product.name,
          qty: item.qty,
          amount,
        })
      }

      await conn.commit()

      res.status(201).json({
        orderId,
        deliveryId: lines[0]!.deliveryId,
        customerId: customer.id,
        amount: totalAmount,
        currency,
        status: 'Pending',
        payMode,
        items: lines,
        // Back-compat for single-item clients
        productName: lines[0]!.productName,
        qty: lines.length === 1 ? lines[0]!.qty : lines.reduce((s, l) => s + l.qty, 0),
      })
    } catch (err) {
      try {
        await conn.rollback()
      } catch {
        /* ignore */
      }
      console.error(err)
      res.status(500).json({ error: 'server_error', message: 'Failed to place order' })
    } finally {
      conn.release()
    }
  },
)
