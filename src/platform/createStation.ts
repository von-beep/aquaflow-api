import bcrypt from 'bcrypt'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { toDateOnlyString } from '../lib/dates.js'
import { slugify, uid } from '../lib/ids.js'

const BCRYPT_ROUNDS = 10

export type CreatedStation = {
  stationId: string
  userId: string
  email: string
  stationName: string
  slug: string
  planStatus: 'trial'
  phone: string
  trialEndsAt: string | null
}

export async function createStationWithOwner(
  conn: PoolConnection,
  input: { stationName: string; email: string; password: string; slug?: string },
): Promise<CreatedStation> {
  const stationName = input.stationName.trim()
  const email = input.email.trim().toLowerCase()
  const password = input.password
  const slugInput = input.slug?.trim().toLowerCase() ?? ''

  if (!stationName || !email || !password) {
    throw Object.assign(new Error('stationName, email, and password are required'), {
      code: 'VALIDATION',
    })
  }
  if (password.length < 8) {
    throw Object.assign(new Error('password must be at least 8 characters'), {
      code: 'VALIDATION',
    })
  }

  const stationId = uid()
  const userId = uid()
  let slug = slugify(slugInput || stationName)
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  for (let i = 0; i < 5; i++) {
    const [existing] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM stations WHERE slug = ? LIMIT 1',
      [slug],
    )
    if ((existing as RowDataPacket[]).length === 0) break
    slug = `${slugify(stationName)}-${uid().slice(-4)}`
  }

  await conn.query<ResultSetHeader>(
    `INSERT INTO stations (id, name, slug, plan_status, trial_ends_at, phone)
     VALUES (?, ?, ?, 'trial', DATE_ADD(CURDATE(), INTERVAL 14 DAY), '')`,
    [stationId, stationName, slug],
  )
  await conn.query<ResultSetHeader>(
    `INSERT INTO settings (station_id, station_name, owner, phone, currency)
     VALUES (?, ?, '', '', '₱')`,
    [stationId, stationName],
  )
  await conn.query<ResultSetHeader>(
    `INSERT INTO inventory (station_id, full_count, empty_count) VALUES (?, 0, 0)`,
    [stationId],
  )
  await conn.query<ResultSetHeader>(
    `INSERT INTO users (id, station_id, email, password_hash, role)
     VALUES (?, ?, ?, ?, 'owner')`,
    [userId, stationId, email, passwordHash],
  )

  const [stationRows] = await conn.query<
    (RowDataPacket & { trial_ends_at: Date | string | null; phone: string })[]
  >(`SELECT id, name, slug, plan_status, trial_ends_at, phone FROM stations WHERE id = ?`, [
    stationId,
  ])
  const stationRow = stationRows[0]

  return {
    stationId,
    userId,
    email,
    stationName,
    slug,
    planStatus: 'trial',
    phone: String(stationRow?.phone ?? ''),
    trialEndsAt: toDateOnlyString(stationRow?.trial_ends_at),
  }
}
