import bcrypt from 'bcrypt'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { ensurePlatformStation } from '../platform/ensurePlatformStation.js'
import { PLATFORM_STATION_ID } from '../platform/planRestore.js'
import { getPool } from './pool.js'

const PLATFORM_ADMIN_EMAIL = 'admin@aquaflow.local'
const DEFAULT_PASSWORD = 'password123'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/**
 * Non-destructive boot strap for Hostinger / production.
 * Unlike `npm run seed`, this never deletes station tenant data.
 *
 * - Creates `s_platform` + `admin@aquaflow.local` if missing
 * - Always keeps `is_platform_admin = 1`
 * - Sets password when creating, or when `PLATFORM_ADMIN_RESET=1`,
 *   or when `PLATFORM_ADMIN_PASSWORD` is set in the environment
 */
export async function ensurePlatformAdmin(): Promise<void> {
  const pool = getPool()
  const passwordEnv = (process.env.PLATFORM_ADMIN_PASSWORD ?? '').trim()
  const password = passwordEnv || DEFAULT_PASSWORD
  const resetFlag = (process.env.PLATFORM_ADMIN_RESET ?? '').trim() === '1'

  await ensurePlatformStation(pool)

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, is_platform_admin FROM users WHERE email = ? LIMIT 1`,
    [PLATFORM_ADMIN_EMAIL],
  )
  const existing = (rows as RowDataPacket[])[0]
  const hash = await bcrypt.hash(password, 10)

  if (!existing) {
    await pool.query<ResultSetHeader>(
      `INSERT INTO users (id, station_id, email, password_hash, role, is_platform_admin)
       VALUES (?, ?, ?, ?, 'owner', 1)`,
      [uid(), PLATFORM_STATION_ID, PLATFORM_ADMIN_EMAIL, hash],
    )
    console.log(`[bootstrap] Created platform admin ${PLATFORM_ADMIN_EMAIL}`)
    return
  }

  await pool.query(
    `UPDATE users
     SET is_platform_admin = 1,
         station_id = ?,
         role = 'owner'
     WHERE id = ?`,
    [PLATFORM_STATION_ID, existing.id],
  )

  if (resetFlag || passwordEnv) {
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      hash,
      existing.id,
    ])
    console.log(
      `[bootstrap] Updated password for ${PLATFORM_ADMIN_EMAIL} (${
        resetFlag ? 'PLATFORM_ADMIN_RESET=1' : 'PLATFORM_ADMIN_PASSWORD set'
      })`,
    )
  } else {
    console.log(`[bootstrap] Platform admin ready: ${PLATFORM_ADMIN_EMAIL}`)
  }
}
