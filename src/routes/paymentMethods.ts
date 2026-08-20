import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { badRequest, notFound, stationId } from '../lib/http.js'
import {
  deletePaymentQrFile,
  paymentQrPublicPath,
  savePaymentQrDataUrl,
  slugifyPaymentName,
} from '../lib/qrph.js'

type MethodRow = RowDataPacket & {
  id: string
  station_id: string
  name: string
  slug: string
  qr_path: string | null
  sort_order: number
}

const RESERVED = new Set(['cash', 'utang', 'cod'])

function mapMethod(r: MethodRow) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    qrUrl: paymentQrPublicPath(r.qr_path),
    sortOrder: Number(r.sort_order) || 0,
    hasQr: Boolean(r.qr_path),
  }
}

async function loadMethod(stationId: string, id: string): Promise<MethodRow | null> {
  const [rows] = await getPool().query<MethodRow[]>(
    `SELECT id, station_id, name, slug, qr_path, sort_order
     FROM station_payment_methods
     WHERE id = ? AND station_id = ?
     LIMIT 1`,
    [id, stationId],
  )
  return (rows as MethodRow[])[0] ?? null
}

export const paymentMethodsRouter = Router()

paymentMethodsRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<MethodRow[]>(
    `SELECT id, station_id, name, slug, qr_path, sort_order
     FROM station_payment_methods
     WHERE station_id = ?
     ORDER BY sort_order ASC, name ASC`,
    [sid],
  )
  res.json({ methods: (rows as MethodRow[]).map(mapMethod) })
})

paymentMethodsRouter.post('/', async (req, res) => {
  const sid = stationId(req)
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 32) : ''
  if (!name) {
    badRequest(res, 'name is required')
    return
  }
  const slug = slugifyPaymentName(name)
  if (!slug || RESERVED.has(slug)) {
    badRequest(res, 'Choose a different payment method name')
    return
  }

  const [maxRows] = await getPool().query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(sort_order), 0) AS mx
     FROM station_payment_methods WHERE station_id = ?`,
    [sid],
  )
  const sortOrder = Number((maxRows as RowDataPacket[])[0]?.mx ?? 0) + 10
  const id = `pm_${uid()}`

  try {
    await getPool().query<ResultSetHeader>(
      `INSERT INTO station_payment_methods (id, station_id, name, slug, qr_path, sort_order)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      [id, sid, name, slug, sortOrder],
    )
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'ER_DUP_ENTRY') {
      res.status(409).json({
        error: 'conflict',
        message: 'That payment method already exists for this station',
      })
      return
    }
    throw err
  }

  const created = await loadMethod(sid, id)
  res.status(201).json({ method: mapMethod(created!) })
})

paymentMethodsRouter.delete('/:id', async (req, res) => {
  const sid = stationId(req)
  const id = String(req.params.id ?? '')
  const existing = await loadMethod(sid, id)
  if (!existing) {
    notFound(res, 'Payment method')
    return
  }
  await deletePaymentQrFile(existing.qr_path)
  await getPool().query(
    `DELETE FROM station_payment_methods WHERE id = ? AND station_id = ?`,
    [id, sid],
  )
  res.json({ ok: true })
})

paymentMethodsRouter.post('/:id/qr', async (req, res) => {
  const sid = stationId(req)
  const id = String(req.params.id ?? '')
  const existing = await loadMethod(sid, id)
  if (!existing) {
    notFound(res, 'Payment method')
    return
  }

  const image = typeof req.body?.image === 'string' ? req.body.image.trim() : ''
  if (!image) {
    badRequest(res, 'image data URL is required')
    return
  }

  let relative: string
  try {
    relative = await savePaymentQrDataUrl(sid, existing.slug, image)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    if (code === 'image_too_large') {
      badRequest(res, 'Image is too large (max ~800KB)')
      return
    }
    badRequest(res, 'Invalid image — use PNG, JPEG, or WebP')
    return
  }

  if (existing.qr_path && existing.qr_path !== relative) {
    await deletePaymentQrFile(existing.qr_path)
  }

  await getPool().query(
    `UPDATE station_payment_methods
     SET qr_path = ?, updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND station_id = ?`,
    [relative, id, sid],
  )

  const updated = await loadMethod(sid, id)
  res.json({ method: mapMethod(updated!) })
})

paymentMethodsRouter.delete('/:id/qr', async (req, res) => {
  const sid = stationId(req)
  const id = String(req.params.id ?? '')
  const existing = await loadMethod(sid, id)
  if (!existing) {
    notFound(res, 'Payment method')
    return
  }
  await deletePaymentQrFile(existing.qr_path)
  await getPool().query(
    `UPDATE station_payment_methods
     SET qr_path = NULL, updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND station_id = ?`,
    [id, sid],
  )
  const updated = await loadMethod(sid, id)
  res.json({ method: mapMethod(updated!) })
})
