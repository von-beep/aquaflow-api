import bcrypt from 'bcrypt'
import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { badRequest, notFound, stationId } from '../lib/http.js'

const BCRYPT_ROUNDS = 10

type RiderRow = RowDataPacket & {
  id: string
  name: string
  phone: string
  account_email: string | null
}

function mapRider(r: RiderRow) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.account_email ?? null,
    hasAccount: Boolean(r.account_email),
  }
}

async function loadRider(sid: string, id: string): Promise<RiderRow | null> {
  const [rows] = await getPool().query<RiderRow[]>(
    `SELECT r.id, r.name, r.phone, u.email AS account_email
     FROM riders r
     LEFT JOIN users u ON u.rider_id = r.id AND u.station_id = r.station_id AND u.role = 'rider'
     WHERE r.id = ? AND r.station_id = ? AND r.deleted_at IS NULL
     LIMIT 1`,
    [id, sid],
  )
  return (rows as RiderRow[])[0] ?? null
}

export const ridersRouter = Router()

ridersRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<RiderRow[]>(
    `SELECT r.id, r.name, r.phone, u.email AS account_email
     FROM riders r
     LEFT JOIN users u ON u.rider_id = r.id AND u.station_id = r.station_id AND u.role = 'rider'
     WHERE r.station_id = ? AND r.deleted_at IS NULL
     ORDER BY r.name`,
    [sid],
  )
  res.json({ riders: (rows as RiderRow[]).map(mapRider) })
})

ridersRouter.get('/:id', async (req, res) => {
  const sid = stationId(req)
  const row = await loadRider(sid, req.params.id)
  if (!row) {
    notFound(res, 'Rider')
    return
  }
  res.json({ rider: mapRider(row) })
})

/**
 * Create rider. Optional email+password creates a /rider login (owner/staff only —
 * gate is on apiRouter).
 */
ridersRouter.post('/', async (req, res) => {
  const sid = stationId(req)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const email =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!name) {
    badRequest(res, 'name is required')
    return
  }
  if (email || password) {
    if (!email || !password) {
      badRequest(res, 'email and password are both required for a rider account')
      return
    }
    if (password.length < 8) {
      badRequest(res, 'password must be at least 8 characters')
      return
    }
  }

  const id = typeof req.body?.id === 'string' && req.body.id ? req.body.id : uid()
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      'INSERT INTO riders (id, station_id, name, phone) VALUES (?, ?, ?, ?)',
      [id, sid, name, phone],
    )

    if (email && password) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const userId = uid()
      await conn.query(
        `INSERT INTO users (id, station_id, email, password_hash, role, rider_id)
         VALUES (?, ?, ?, ?, 'rider', ?)`,
        [userId, sid, email, passwordHash, id],
      )
    }

    await conn.commit()
    const row = await loadRider(sid, id)
    res.status(201).json({ rider: row ? mapRider(row) : { id, name, phone, email: email || null, hasAccount: Boolean(email) } })
  } catch (err: unknown) {
    await conn.rollback()
    const code = (err as { code?: string }).code
    if (code === 'ER_DUP_ENTRY') {
      res.status(409).json({
        error: 'conflict',
        message: 'Email already in use or rider id exists',
      })
      return
    }
    throw err
  } finally {
    conn.release()
  }
})

ridersRouter.put('/:id', async (req, res) => {
  const sid = stationId(req)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const email =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!name) {
    badRequest(res, 'name is required')
    return
  }
  if (password && password.length < 8) {
    badRequest(res, 'password must be at least 8 characters')
    return
  }
  if (password && !email) {
    // Creating/updating account needs email
    const existing = await loadRider(sid, req.params.id)
    if (!existing?.account_email) {
      badRequest(res, 'email is required when setting a password')
      return
    }
  }

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result] = await conn.query<ResultSetHeader>(
      'UPDATE riders SET name = ?, phone = ? WHERE id = ? AND station_id = ? AND deleted_at IS NULL',
      [name, phone, req.params.id, sid],
    )
    if (result.affectedRows === 0) {
      await conn.rollback()
      notFound(res, 'Rider')
      return
    }

    const [userRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, email FROM users
       WHERE rider_id = ? AND station_id = ? AND role = 'rider' LIMIT 1`,
      [req.params.id, sid],
    )
    const user = (userRows as RowDataPacket[])[0]

    if (email || password) {
      if (user) {
        const nextEmail = email || String(user.email)
        if (password) {
          const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
          await conn.query(
            `UPDATE users SET email = ?, password_hash = ? WHERE id = ? AND station_id = ?`,
            [nextEmail, passwordHash, user.id, sid],
          )
        } else if (email) {
          await conn.query(
            `UPDATE users SET email = ? WHERE id = ? AND station_id = ?`,
            [email, user.id, sid],
          )
        }
      } else if (email && password) {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
        await conn.query(
          `INSERT INTO users (id, station_id, email, password_hash, role, rider_id)
           VALUES (?, ?, ?, ?, 'rider', ?)`,
          [uid(), sid, email, passwordHash, req.params.id],
        )
      } else {
        await conn.rollback()
        badRequest(res, 'email and password are required to create a rider account')
        return
      }
    }

    await conn.commit()
    const row = await loadRider(sid, req.params.id)
    if (!row) {
      notFound(res, 'Rider')
      return
    }
    res.json({ rider: mapRider(row) })
  } catch (err: unknown) {
    await conn.rollback()
    const code = (err as { code?: string }).code
    if (code === 'ER_DUP_ENTRY') {
      res.status(409).json({
        error: 'conflict',
        message: 'Email already in use',
      })
      return
    }
    throw err
  } finally {
    conn.release()
  }
})

ridersRouter.delete('/:id', async (req, res) => {
  const sid = stationId(req)
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `DELETE FROM users WHERE rider_id = ? AND station_id = ? AND role = 'rider'`,
      [req.params.id, sid],
    )
    const [result] = await conn.query<ResultSetHeader>(
      'UPDATE riders SET deleted_at = UTC_TIMESTAMP(3) WHERE id = ? AND station_id = ? AND deleted_at IS NULL',
      [req.params.id, sid],
    )
    if (result.affectedRows === 0) {
      await conn.rollback()
      notFound(res, 'Rider')
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
