import type { Pool } from 'mysql2/promise'
import { PLATFORM_STATION_ID } from '../platform/planRestore.js'

/** Ensure internal platform station + settings/inventory exist (no admin user). */
export async function ensurePlatformStation(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO stations (id, name, slug, plan_status, phone, trial_ends_at)
     VALUES (?, 'AquaFlow Platform', 'platform', 'active', '', NULL)
     ON DUPLICATE KEY UPDATE name = VALUES(name), plan_status = 'active'`,
    [PLATFORM_STATION_ID],
  )
  await pool.query(
    `INSERT INTO settings (station_id, station_name, owner, phone, currency)
     VALUES (?, 'AquaFlow Platform', '', '', '₱')
     ON DUPLICATE KEY UPDATE station_name = VALUES(station_name)`,
    [PLATFORM_STATION_ID],
  )
  await pool.query(
    `INSERT INTO inventory (station_id, full_count, empty_count)
     VALUES (?, 0, 0)
     ON DUPLICATE KEY UPDATE full_count = full_count`,
    [PLATFORM_STATION_ID],
  )
}
