import bcrypt from 'bcrypt'
import { timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { toDateOnlyString } from '../lib/dates.js'
import { JWT_EXPIRES_IN, signToken } from '../lib/jwt.js'
import { requireAuth } from '../middleware/auth.js'
import { createStationWithOwner } from '../platform/createStation.js'
import { ensurePlatformStation } from '../platform/ensurePlatformStation.js'
import { PLATFORM_STATION_ID } from '../platform/planRestore.js'

type UserRow = RowDataPacket & {
  id: string
  station_id: string
  email: string
  password_hash: string
  role: 'owner' | 'staff' | 'rider'
  rider_id: string | null
  is_platform_admin: number
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const authRouter = Router()

/**
 * Register a platform admin (ops) user. Requires PLATFORM_REGISTER_SECRET in env.
 * Does not create a tenant station.
 */
authRouter.post('/platform/register', async (req, res) => {
  const expected = (process.env.PLATFORM_REGISTER_SECRET ?? '').trim()
  if (!expected) {
    res.status(503).json({
      error: 'unavailable',
      message: 'Platform registration is not configured',
    })
    return
  }

  const secretCode =
    typeof req.body?.secretCode === 'string' ? req.body.secretCode : ''
  const email =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!secretsMatch(secretCode, expected)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Invalid registration code',
    })
    return
  }

  if (!email || !password) {
    res.status(400).json({
      error: 'validation_error',
      message: 'email and password are required',
    })
    return
  }
  if (password.length < 8) {
    res.status(400).json({
      error: 'validation_error',
      message: 'password must be at least 8 characters',
    })
    return
  }

  const pool = getPool()
  try {
    await ensurePlatformStation(pool)

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [email],
    )
    if ((existing as RowDataPacket[])[0]) {
      res.status(409).json({
        error: 'conflict',
        message: 'Email already in use',
      })
      return
    }

    const userId = uid()
    const hash = await bcrypt.hash(password, 10)
    await pool.query<ResultSetHeader>(
      `INSERT INTO users (id, station_id, email, password_hash, role, is_platform_admin)
       VALUES (?, ?, ?, ?, 'owner', 1)`,
      [userId, PLATFORM_STATION_ID, email, hash],
    )

    const [stationRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, slug, plan_status, trial_ends_at, phone FROM stations WHERE id = ? LIMIT 1`,
      [PLATFORM_STATION_ID],
    )
    const station = (stationRows as RowDataPacket[])[0]
    if (!station) {
      res.status(500).json({
        error: 'server_error',
        message: 'Platform station missing',
      })
      return
    }

    const token = signToken({
      sub: userId,
      stationId: PLATFORM_STATION_ID,
      role: 'owner',
    })
    res.status(201).json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: userId,
        email,
        role: 'owner',
        stationId: PLATFORM_STATION_ID,
        riderId: null,
        isPlatformAdmin: true,
      },
      station: {
        id: station.id,
        name: station.name,
        slug: station.slug,
        planStatus: station.plan_status,
        phone: station.phone ?? '',
        trialEndsAt: toDateOnlyString(station.trial_ends_at),
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Registration failed' })
  }
})

/** Public self-serve signup kept for API clients; primary UX is platform create. */
authRouter.post('/register', async (req, res) => {
  const stationName =
    typeof req.body?.stationName === 'string' ? req.body.stationName.trim() : ''
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const slugInput = typeof req.body?.slug === 'string' ? req.body.slug.trim().toLowerCase() : ''

  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()
    const created = await createStationWithOwner(conn, {
      stationName,
      email,
      password,
      slug: slugInput || undefined,
    })
    await conn.commit()

    const token = signToken({
      sub: created.userId,
      stationId: created.stationId,
      role: 'owner',
    })
    res.status(201).json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: created.userId,
        email: created.email,
        role: 'owner',
        stationId: created.stationId,
        riderId: null,
        isPlatformAdmin: false,
      },
      station: {
        id: created.stationId,
        name: created.stationName,
        slug: created.slug,
        planStatus: created.planStatus,
        phone: created.phone,
        trialEndsAt: created.trialEndsAt,
      },
    })
  } catch (err: unknown) {
    await conn.rollback()
    const code = (err as { code?: string }).code
    if (code === 'VALIDATION') {
      res.status(400).json({
        error: 'validation_error',
        message: err instanceof Error ? err.message : 'Invalid input',
      })
      return
    }
    if (code === 'ER_DUP_ENTRY') {
      res.status(409).json({
        error: 'conflict',
        message: 'Email or station slug already in use',
      })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Registration failed' })
  } finally {
    conn.release()
  }
})

authRouter.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!email || !password) {
    res.status(400).json({
      error: 'validation_error',
      message: 'email and password are required',
    })
    return
  }

  const pool = getPool()
  try {
    const [rows] = await pool.query<UserRow[]>(
      `SELECT id, station_id, email, password_hash, role, rider_id, is_platform_admin
       FROM users WHERE email = ? LIMIT 1`,
      [email],
    )
    const user = (rows as UserRow[])[0]
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

    if (user.role === 'rider' && !user.rider_id) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Rider account is not linked to a rider profile',
      })
      return
    }

    const [stationRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, slug, plan_status, trial_ends_at, phone FROM stations WHERE id = ? LIMIT 1`,
      [user.station_id],
    )
    const station = (stationRows as RowDataPacket[])[0]
    if (!station) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Station not found for user',
      })
      return
    }
    if (station.plan_status === 'suspended' && !Number(user.is_platform_admin)) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Station is suspended',
      })
      return
    }

    const token = signToken({
      sub: user.id,
      stationId: user.station_id,
      role: user.role,
      ...(user.role === 'rider' && user.rider_id
        ? { riderId: user.rider_id }
        : {}),
    })
    res.json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        stationId: user.station_id,
        riderId: user.rider_id,
        isPlatformAdmin: Boolean(Number(user.is_platform_admin)),
      },
      station: {
        id: station.id,
        name: station.name,
        slug: station.slug,
        planStatus: station.plan_status,
        phone: station.phone ?? '',
        trialEndsAt: toDateOnlyString(station.trial_ends_at),
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Login failed' })
  }
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const auth = req.auth
  if (!auth) {
    res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' })
    return
  }

  const pool = getPool()
  try {
    const [rows] = await pool.query<UserRow[]>(
      `SELECT id, station_id, email, role, rider_id, is_platform_admin FROM users
       WHERE id = ? AND station_id = ? LIMIT 1`,
      [auth.id, auth.stationId],
    )
    const user = (rows as UserRow[])[0]
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'User not found' })
      return
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        stationId: user.station_id,
        riderId: user.rider_id,
        isPlatformAdmin: Boolean(Number(user.is_platform_admin)),
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Failed to load profile' })
  }
})

const BCRYPT_ROUNDS = 10

/** Change password for the signed-in station user (owner, staff, or rider). */
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const auth = req.auth
  if (!auth) {
    res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' })
    return
  }

  const currentPassword =
    typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
  const newPassword =
    typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''

  if (!currentPassword || !newPassword) {
    res.status(400).json({
      error: 'validation_error',
      message: 'currentPassword and newPassword are required',
    })
    return
  }
  if (newPassword.length < 8) {
    res.status(400).json({
      error: 'validation_error',
      message: 'newPassword must be at least 8 characters',
    })
    return
  }
  if (currentPassword === newPassword) {
    res.status(400).json({
      error: 'validation_error',
      message: 'New password must be different from the current password',
    })
    return
  }

  const pool = getPool()
  try {
    const [rows] = await pool.query<UserRow[]>(
      `SELECT id, station_id, password_hash FROM users
       WHERE id = ? AND station_id = ? LIMIT 1`,
      [auth.id, auth.stationId],
    )
    const user = (rows as UserRow[])[0]
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'User not found' })
      return
    }

    const ok = await bcrypt.compare(currentPassword, user.password_hash)
    if (!ok) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Current password is incorrect',
      })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await pool.query(
      `UPDATE users SET password_hash = ? WHERE id = ? AND station_id = ?`,
      [passwordHash, auth.id, auth.stationId],
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Could not update password' })
  }
})
