import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { badRequest, notFound, stationId } from '../lib/http.js'

type ProductRow = RowDataPacket & {
  id: string
  name: string
  price: number
}

function mapProduct(r: ProductRow) {
  return { id: r.id, name: r.name, price: Number(r.price) }
}

export const productsRouter = Router()

productsRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<ProductRow[]>(
    'SELECT id, name, price FROM products WHERE station_id = ? AND deleted_at IS NULL ORDER BY name',
    [sid],
  )
  res.json({ products: (rows as ProductRow[]).map(mapProduct) })
})

productsRouter.get('/:id', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<ProductRow[]>(
    'SELECT id, name, price FROM products WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1',
    [req.params.id, sid],
  )
  const row = (rows as ProductRow[])[0]
  if (!row) {
    notFound(res, 'Product')
    return
  }
  res.json({ product: mapProduct(row) })
})

productsRouter.post('/', async (req, res) => {
  const sid = stationId(req)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const price = Number(req.body?.price)
  if (!name || !Number.isFinite(price) || price < 0) {
    badRequest(res, 'name and non-negative price are required')
    return
  }
  const id = typeof req.body?.id === 'string' && req.body.id ? req.body.id : uid()
  await getPool().query<ResultSetHeader>(
    'INSERT INTO products (id, station_id, name, price) VALUES (?, ?, ?, ?)',
    [id, sid, name, price],
  )
  res.status(201).json({ product: { id, name, price } })
})

productsRouter.put('/:id', async (req, res) => {
  const sid = stationId(req)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const price = Number(req.body?.price)
  if (!name || !Number.isFinite(price) || price < 0) {
    badRequest(res, 'name and non-negative price are required')
    return
  }
  // Upsert so local-only products (post sync-removal) can publish to landing.
  await getPool().query<ResultSetHeader>(
    `INSERT INTO products (id, station_id, name, price, deleted_at)
     VALUES (?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       price = VALUES(price),
       deleted_at = NULL,
       updated_at = UTC_TIMESTAMP(3)`,
    [req.params.id, sid, name, price],
  )
  res.json({ product: { id: req.params.id, name, price } })
})

productsRouter.delete('/:id', async (req, res) => {
  const sid = stationId(req)
  // Soft-delete (deliveries FK). Idempotent if already deleted.
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE products
     SET deleted_at = COALESCE(deleted_at, UTC_TIMESTAMP(3)),
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND station_id = ?`,
    [req.params.id, sid],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Product')
    return
  }
  res.status(204).send()
})
