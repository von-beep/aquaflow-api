import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { requireConsumerAuth } from '../middleware/auth.js'

type AddressRow = RowDataPacket & {
  id: string
  label: string
  address: string
  is_default: number
}

function mapAddress(r: AddressRow) {
  return {
    id: r.id,
    label: r.label,
    address: r.address,
    isDefault: Boolean(r.is_default),
  }
}

export const consumerAddressesRouter = Router()

consumerAddressesRouter.use(requireConsumerAuth)

consumerAddressesRouter.get('/addresses', async (req, res) => {
  const [rows] = await getPool().query<AddressRow[]>(
    `SELECT id, label, address, is_default
     FROM consumer_addresses
     WHERE consumer_user_id = ?
     ORDER BY is_default DESC, updated_at DESC`,
    [req.consumer!.id],
  )
  res.json({ addresses: (rows as AddressRow[]).map(mapAddress) })
})

consumerAddressesRouter.post('/addresses', async (req, res) => {
  const label =
    typeof req.body?.label === 'string' && req.body.label.trim()
      ? req.body.label.trim().slice(0, 64)
      : 'Home'
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
  const isDefault = Boolean(req.body?.isDefault)

  if (!address) {
    res.status(400).json({
      error: 'validation_error',
      message: 'address is required',
    })
    return
  }

  const id = uid()
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    if (isDefault) {
      await conn.query(
        `UPDATE consumer_addresses SET is_default = 0
         WHERE consumer_user_id = ?`,
        [req.consumer!.id],
      )
    }
    // First address becomes default automatically.
    const [countRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM consumer_addresses WHERE consumer_user_id = ?`,
      [req.consumer!.id],
    )
    const count = Number((countRows as { n: number }[])[0]?.n ?? 0)
    const makeDefault = isDefault || count === 0

    await conn.query(
      `INSERT INTO consumer_addresses (id, consumer_user_id, label, address, is_default)
       VALUES (?, ?, ?, ?, ?)`,
      [id, req.consumer!.id, label, address, makeDefault ? 1 : 0],
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  const [rows] = await getPool().query<AddressRow[]>(
    `SELECT id, label, address, is_default FROM consumer_addresses WHERE id = ? LIMIT 1`,
    [id],
  )
  res.status(201).json({ address: mapAddress((rows as AddressRow[])[0]) })
})

consumerAddressesRouter.put('/addresses/:id', async (req, res) => {
  const label =
    typeof req.body?.label === 'string' && req.body.label.trim()
      ? req.body.label.trim().slice(0, 64)
      : undefined
  const address =
    typeof req.body?.address === 'string' ? req.body.address.trim() : undefined
  const isDefault =
    req.body?.isDefault === undefined ? undefined : Boolean(req.body.isDefault)

  if (label === undefined && address === undefined && isDefault === undefined) {
    res.status(400).json({
      error: 'validation_error',
      message: 'label, address, or isDefault is required',
    })
    return
  }
  if (address !== undefined && !address) {
    res.status(400).json({
      error: 'validation_error',
      message: 'address cannot be empty',
    })
    return
  }

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [existing] = await conn.query<AddressRow[]>(
      `SELECT id, label, address, is_default FROM consumer_addresses
       WHERE id = ? AND consumer_user_id = ? LIMIT 1`,
      [req.params.id, req.consumer!.id],
    )
    if (!(existing as AddressRow[]).length) {
      await conn.rollback()
      res.status(404).json({ error: 'not_found', message: 'Address not found' })
      return
    }

    if (isDefault === true) {
      await conn.query(
        `UPDATE consumer_addresses SET is_default = 0 WHERE consumer_user_id = ?`,
        [req.consumer!.id],
      )
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (label !== undefined) {
      sets.push('label = ?')
      params.push(label)
    }
    if (address !== undefined) {
      sets.push('address = ?')
      params.push(address)
    }
    if (isDefault !== undefined) {
      sets.push('is_default = ?')
      params.push(isDefault ? 1 : 0)
    }
    sets.push('updated_at = UTC_TIMESTAMP(3)')
    params.push(req.params.id, req.consumer!.id)

    await conn.query(
      `UPDATE consumer_addresses SET ${sets.join(', ')}
       WHERE id = ? AND consumer_user_id = ?`,
      params,
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  const [rows] = await getPool().query<AddressRow[]>(
    `SELECT id, label, address, is_default FROM consumer_addresses
     WHERE id = ? AND consumer_user_id = ? LIMIT 1`,
    [req.params.id, req.consumer!.id],
  )
  res.json({ address: mapAddress((rows as AddressRow[])[0]) })
})

consumerAddressesRouter.delete('/addresses/:id', async (req, res) => {
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [existing] = await conn.query<AddressRow[]>(
      `SELECT id, is_default FROM consumer_addresses
       WHERE id = ? AND consumer_user_id = ? LIMIT 1`,
      [req.params.id, req.consumer!.id],
    )
    const row = (existing as AddressRow[])[0]
    if (!row) {
      await conn.rollback()
      res.status(404).json({ error: 'not_found', message: 'Address not found' })
      return
    }

    const [result] = await conn.query<ResultSetHeader>(
      `DELETE FROM consumer_addresses WHERE id = ? AND consumer_user_id = ?`,
      [req.params.id, req.consumer!.id],
    )
    if (result.affectedRows === 0) {
      await conn.rollback()
      res.status(404).json({ error: 'not_found', message: 'Address not found' })
      return
    }

    if (row.is_default) {
      const [nextRows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM consumer_addresses
         WHERE consumer_user_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [req.consumer!.id],
      )
      const nextId = (nextRows as { id: string }[])[0]?.id
      if (nextId) {
        await conn.query(
          `UPDATE consumer_addresses SET is_default = 1 WHERE id = ?`,
          [nextId],
        )
      }
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
