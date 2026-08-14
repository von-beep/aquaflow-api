import bcrypt from 'bcrypt'
import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'
import { JWT_EXPIRES_IN, signToken } from '../lib/jwt.js'
import { requireConsumerAuth } from '../middleware/auth.js'

const BCRYPT_ROUNDS = 10

type ConsumerRow = RowDataPacket & {
  id: string
  email: string
  password_hash: string
  name: string
  phone: string
}

function mapConsumer(r: ConsumerRow) {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    phone: r.phone,
  }
}

export const consumerAuthRouter = Router()

consumerAuthRouter.post('/register', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''

  if (!email || !password || password.length < 6) {
    res.status(400).json({
      error: 'validation_error',
      message: 'email and password (min 6 characters) are required',
    })
    return
  }
  if (!name) {
    res.status(400).json({
      error: 'validation_error',
      message: 'name is required',
    })
    return
  }

  const id = uid()
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  try {
    await getPool().query(
      `INSERT INTO consumer_users (id, email, password_hash, name, phone)
       VALUES (?, ?, ?, ?, ?)`,
      [id, email, passwordHash, name, phone],
    )
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'ER_DUP_ENTRY') {
      res.status(409).json({
        error: 'conflict',
        message: 'An account with this email already exists',
      })
      return
    }
    throw err
  }

  const token = signToken({ sub: id, kind: 'consumer' })
  res.status(201).json({
    token,
    expiresIn: JWT_EXPIRES_IN,
    consumer: { id, email, name, phone },
  })
})

consumerAuthRouter.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!email || !password) {
    res.status(400).json({
      error: 'validation_error',
      message: 'email and password are required',
    })
    return
  }

  const [rows] = await getPool().query<ConsumerRow[]>(
    `SELECT id, email, password_hash, name, phone
     FROM consumer_users WHERE email = ? LIMIT 1`,
    [email],
  )
  const user = (rows as ConsumerRow[])[0]
  if (!user) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid email or password',
    })
    return
  }

  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid email or password',
    })
    return
  }

  const token = signToken({ sub: user.id, kind: 'consumer' })
  res.json({
    token,
    expiresIn: JWT_EXPIRES_IN,
    consumer: mapConsumer(user),
  })
})

consumerAuthRouter.get('/me', requireConsumerAuth, async (req, res) => {
  const [rows] = await getPool().query<ConsumerRow[]>(
    `SELECT id, email, password_hash, name, phone
     FROM consumer_users WHERE id = ? LIMIT 1`,
    [req.consumer!.id],
  )
  const user = (rows as ConsumerRow[])[0]
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'Account not found' })
    return
  }
  res.json({ consumer: mapConsumer(user) })
})

consumerAuthRouter.patch('/me', requireConsumerAuth, async (req, res) => {
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
  const phone =
    typeof req.body?.phone === 'string' ? req.body.phone.trim() : undefined

  if (name === undefined && phone === undefined) {
    res.status(400).json({
      error: 'validation_error',
      message: 'name or phone is required',
    })
    return
  }
  if (name !== undefined && !name) {
    res.status(400).json({
      error: 'validation_error',
      message: 'name cannot be empty',
    })
    return
  }

  const sets: string[] = []
  const params: unknown[] = []
  if (name !== undefined) {
    sets.push('name = ?')
    params.push(name)
  }
  if (phone !== undefined) {
    sets.push('phone = ?')
    params.push(phone)
  }
  sets.push('updated_at = UTC_TIMESTAMP(3)')
  params.push(req.consumer!.id)

  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE consumer_users SET ${sets.join(', ')} WHERE id = ?`,
    params,
  )
  if (result.affectedRows === 0) {
    res.status(401).json({ error: 'unauthorized', message: 'Account not found' })
    return
  }

  const [rows] = await getPool().query<ConsumerRow[]>(
    `SELECT id, email, password_hash, name, phone
     FROM consumer_users WHERE id = ? LIMIT 1`,
    [req.consumer!.id],
  )
  res.json({ consumer: mapConsumer((rows as ConsumerRow[])[0]) })
})
