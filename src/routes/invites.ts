import { randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { toDateOnlyString } from '../lib/dates.js'
import { uid } from '../lib/ids.js'
import { JWT_EXPIRES_IN, signToken } from '../lib/jwt.js'
import { requireOwner } from '../middleware/requireOwner.js'
import { badRequest, notFound, stationId } from '../lib/http.js'

const BCRYPT_ROUNDS = 10
const INVITE_DAYS = 7

type InviteRow = RowDataPacket & {
  id: string
  station_id: string
  email: string | null
  token: string
  role: string
  expires_at: Date | string
  accepted_at: Date | string | null
  station_name?: string
}

function mapInvite(r: InviteRow) {
  const expiresAt =
    typeof r.expires_at === 'string'
      ? new Date(r.expires_at).toISOString()
      : r.expires_at.toISOString()
  return {
    id: r.id,
    email: r.email,
    token: r.token,
    role: r.role,
    expiresAt,
    accepted: Boolean(r.accepted_at),
    inviteUrlPath: `/invite/${r.token}`,
  }
}

export const invitesRouter = Router()

/** Owner: list open invites for this station */
invitesRouter.get('/', requireOwner, async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<InviteRow[]>(
    `SELECT id, station_id, email, token, role, expires_at, accepted_at
     FROM invites WHERE station_id = ? ORDER BY created_at DESC`,
    [sid],
  )
  res.json({ invites: (rows as InviteRow[]).map(mapInvite) })
})

/** Owner: create invite (optional email hint) */
invitesRouter.post('/', requireOwner, async (req, res) => {
  const sid = stationId(req)
  const email =
    typeof req.body?.email === 'string' && req.body.email.trim()
      ? req.body.email.trim().toLowerCase()
      : null
  const token = randomBytes(24).toString('hex')
  const id = uid()
  const expires = new Date()
  expires.setDate(expires.getDate() + INVITE_DAYS)

  await getPool().query<ResultSetHeader>(
    `INSERT INTO invites (id, station_id, email, token, role, created_by, expires_at)
     VALUES (?, ?, ?, ?, 'staff', ?, ?)`,
    [id, sid, email, token, req.auth!.id, expires],
  )

  const [rows] = await getPool().query<InviteRow[]>(
    `SELECT id, station_id, email, token, role, expires_at, accepted_at
     FROM invites WHERE id = ? LIMIT 1`,
    [id],
  )
  res.status(201).json({ invite: mapInvite((rows as InviteRow[])[0]) })
})

/** Public: preview invite */
export const publicInviteRouter = Router()

publicInviteRouter.get('/:token', async (req, res) => {
  const [rows] = await getPool().query<InviteRow[]>(
    `SELECT i.id, i.station_id, i.email, i.token, i.role, i.expires_at, i.accepted_at,
            s.name AS station_name
     FROM invites i
     JOIN stations s ON s.id = i.station_id
     WHERE i.token = ? LIMIT 1`,
    [req.params.token],
  )
  const invite = (rows as InviteRow[])[0]
  if (!invite) {
    notFound(res, 'Invite')
    return
  }
  const expiresAt = new Date(invite.expires_at)
  if (invite.accepted_at) {
    res.status(410).json({ error: 'gone', message: 'Invite already accepted' })
    return
  }
  if (expiresAt.getTime() < Date.now()) {
    res.status(410).json({ error: 'gone', message: 'Invite expired' })
    return
  }
  res.json({
    invite: {
      email: invite.email,
      role: invite.role,
      expiresAt: expiresAt.toISOString(),
      stationName: invite.station_name,
    },
  })
})

/** Public: accept invite → staff user + JWT */
publicInviteRouter.post('/:token/accept', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!email || !password) {
    badRequest(res, 'email and password are required')
    return
  }
  if (password.length < 8) {
    badRequest(res, 'password must be at least 8 characters')
    return
  }

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query<InviteRow[]>(
      `SELECT id, station_id, email, token, role, expires_at, accepted_at
       FROM invites WHERE token = ? LIMIT 1 FOR UPDATE`,
      [req.params.token],
    )
    const invite = (rows as InviteRow[])[0]
    if (!invite) {
      await conn.rollback()
      notFound(res, 'Invite')
      return
    }
    if (invite.accepted_at) {
      await conn.rollback()
      res.status(410).json({ error: 'gone', message: 'Invite already accepted' })
      return
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await conn.rollback()
      res.status(410).json({ error: 'gone', message: 'Invite expired' })
      return
    }
    if (invite.email && invite.email !== email) {
      await conn.rollback()
      res.status(400).json({
        error: 'validation_error',
        message: 'Email must match the invite',
      })
      return
    }

    const [stationRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, name, slug, plan_status, trial_ends_at, phone
       FROM stations WHERE id = ? LIMIT 1`,
      [invite.station_id],
    )
    const station = (stationRows as RowDataPacket[])[0]
    if (!station || station.plan_status === 'suspended') {
      await conn.rollback()
      res.status(403).json({ error: 'forbidden', message: 'Station unavailable' })
      return
    }

    const userId = uid()
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await conn.query(
      `INSERT INTO users (id, station_id, email, password_hash, role)
       VALUES (?, ?, ?, ?, 'staff')`,
      [userId, invite.station_id, email, hash],
    )
    await conn.query(
      `UPDATE invites SET accepted_at = UTC_TIMESTAMP(), accepted_user_id = ?
       WHERE id = ?`,
      [userId, invite.id],
    )
    await conn.commit()

    const token = signToken({
      sub: userId,
      stationId: invite.station_id,
      role: 'staff',
    })
    res.status(201).json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: userId,
        email,
        role: 'staff',
        stationId: invite.station_id,
        riderId: null,
      },
      station: {
        id: station.id,
        name: station.name,
        slug: station.slug,
        planStatus: station.plan_status,
        phone: station.phone,
        trialEndsAt: toDateOnlyString(station.trial_ends_at),
      },
    })
  } catch (err: unknown) {
    await conn.rollback()
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'conflict', message: 'Email already in use' })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Could not accept invite' })
  } finally {
    conn.release()
  }
})
