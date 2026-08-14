import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { customerBalance, isClear } from '../domain/balance.js'
import { deleteCustomerCascade } from '../domain/cascade.js'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { badRequest, notFound, stationId } from '../lib/http.js'

type CustomerRow = RowDataPacket & {
  id: string
  name: string
  phone: string
  addr: string
  gallons_out: number
  note: string
}

function mapCustomer(r: CustomerRow, balance?: number) {
  const base = {
    id: r.id,
    name: r.name,
    phone: r.phone,
    addr: r.addr,
    gallonsOut: Number(r.gallons_out),
    note: r.note,
  }
  if (balance === undefined) return base
  return { ...base, balance, clear: isClear(balance) }
}

async function loadBalance(stationId: string, customerId: string): Promise<number> {
  const pool = getPool()
  const [utangRows] = await pool.query<RowDataPacket[]>(
    'SELECT customer_id AS customerId, amount FROM utang WHERE station_id = ? AND customer_id = ? AND deleted_at IS NULL',
    [stationId, customerId],
  )
  const [payRows] = await pool.query<RowDataPacket[]>(
    'SELECT customer_id AS customerId, amount FROM payments WHERE station_id = ? AND customer_id = ? AND deleted_at IS NULL',
    [stationId, customerId],
  )
  return customerBalance(
    customerId,
    utangRows as { customerId: string; amount: number }[],
    payRows as { customerId: string; amount: number }[],
  )
}

export const customersRouter = Router()

customersRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const pool = getPool()
  const [rows] = await pool.query<CustomerRow[]>(
    'SELECT id, name, phone, addr, gallons_out, note FROM customers WHERE station_id = ? AND deleted_at IS NULL ORDER BY name',
    [sid],
  )
  const [utangRows] = await pool.query<RowDataPacket[]>(
    'SELECT customer_id AS customerId, amount FROM utang WHERE station_id = ? AND deleted_at IS NULL',
    [sid],
  )
  const [payRows] = await pool.query<RowDataPacket[]>(
    'SELECT customer_id AS customerId, amount FROM payments WHERE station_id = ? AND deleted_at IS NULL',
    [sid],
  )
  const utang = utangRows as { customerId: string; amount: number }[]
  const payments = payRows as { customerId: string; amount: number }[]
  res.json({
    customers: (rows as CustomerRow[]).map((r) =>
      mapCustomer(r, customerBalance(r.id, utang, payments)),
    ),
  })
})

customersRouter.get('/:id', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<CustomerRow[]>(
    'SELECT id, name, phone, addr, gallons_out, note FROM customers WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1',
    [req.params.id, sid],
  )
  const row = (rows as CustomerRow[])[0]
  if (!row) {
    notFound(res, 'Customer')
    return
  }
  const balance = await loadBalance(sid, row.id)
  res.json({ customer: mapCustomer(row, balance) })
})

customersRouter.post('/', async (req, res) => {
  const sid = stationId(req)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const addr = typeof req.body?.addr === 'string' ? req.body.addr.trim() : ''
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  const gallonsOut = Number(req.body?.gallonsOut ?? 0)
  if (!name) {
    badRequest(res, 'name is required')
    return
  }
  const id = typeof req.body?.id === 'string' && req.body.id ? req.body.id : uid()
  await getPool().query(
    `INSERT INTO customers (id, station_id, name, phone, addr, gallons_out, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, sid, name, phone, addr, Number.isFinite(gallonsOut) ? gallonsOut : 0, note],
  )
  res.status(201).json({
    customer: mapCustomer(
      {
        id,
        name,
        phone,
        addr,
        gallons_out: gallonsOut,
        note,
      } as CustomerRow,
      0,
    ),
  })
})

customersRouter.put('/:id', async (req, res) => {
  const sid = stationId(req)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const addr = typeof req.body?.addr === 'string' ? req.body.addr.trim() : ''
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  const gallonsOut = Number(req.body?.gallonsOut ?? 0)
  if (!name) {
    badRequest(res, 'name is required')
    return
  }
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE customers
     SET name = ?, phone = ?, addr = ?, gallons_out = ?, note = ?
     WHERE id = ? AND station_id = ? AND deleted_at IS NULL`,
    [name, phone, addr, Number.isFinite(gallonsOut) ? gallonsOut : 0, note, req.params.id, sid],
  )
  if (result.affectedRows === 0) {
    notFound(res, 'Customer')
    return
  }
  const balance = await loadBalance(sid, req.params.id)
  res.json({
    customer: mapCustomer(
      {
        id: req.params.id,
        name,
        phone,
        addr,
        gallons_out: gallonsOut,
        note,
      } as CustomerRow,
      balance,
    ),
  })
})

customersRouter.delete('/:id', async (req, res) => {
  const sid = stationId(req)
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const ok = await deleteCustomerCascade(conn, sid, req.params.id)
    if (!ok) {
      await conn.rollback()
      notFound(res, 'Customer')
      return
    }
    await conn.commit()
    res.status(204).send()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})
