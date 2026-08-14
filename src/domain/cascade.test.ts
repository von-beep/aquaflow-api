import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcrypt'
import { closePool, getPool, waitForDb } from '../db/pool.js'
import { deleteCustomerCascade } from './cascade.js'
import { uid } from '../lib/ids.js'

const STA = 's_test_a'
const STB = 's_test_b'

async function ensureTables(): Promise<boolean> {
  try {
    await waitForDb({ attempts: 5, delayMs: 500 })
    const [rows] = await getPool().query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'stations'`,
    )
    return Number((rows as { cnt: number }[])[0]?.cnt) === 1
  } catch {
    return false
  }
}

describe('cascade + tenant isolation', () => {
  let ready = false

  beforeAll(async () => {
    ready = await ensureTables()
    if (!ready) return

    const pool = getPool()
    const hash = await bcrypt.hash('password123', 4)
    await pool.query('DELETE FROM payments WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM utang WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM deliveries WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM customers WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM products WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM users WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM settings WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM inventory WHERE station_id IN (?, ?)', [STA, STB])
    await pool.query('DELETE FROM stations WHERE id IN (?, ?)', [STA, STB])

    await pool.query(
      `INSERT INTO stations (id, name, slug, plan_status) VALUES
       (?, 'Station A', 'test-a', 'trial'),
       (?, 'Station B', 'test-b', 'trial')`,
      [STA, STB],
    )
    await pool.query(
      `INSERT INTO users (id, station_id, email, password_hash, role) VALUES
       (?, ?, 'a@test.local', ?, 'owner'),
       (?, ?, 'b@test.local', ?, 'owner')`,
      [uid(), STA, hash, uid(), STB, hash],
    )
    await pool.query(
      `INSERT INTO customers (id, station_id, name, phone, addr, gallons_out, note) VALUES
       ('ca1', ?, 'Cust A', '', '', 0, ''),
       ('cb1', ?, 'Cust B', '', '', 0, '')`,
      [STA, STB],
    )
    await pool.query(
      `INSERT INTO products (id, station_id, name, price) VALUES
       ('pa1', ?, 'Prod A', 10),
       ('pb1', ?, 'Prod B', 20)`,
      [STA, STB],
    )
    await pool.query(
      `INSERT INTO riders (id, station_id, name, phone) VALUES ('ra1', ?, 'Rider A', '')`,
      [STA],
    )
    await pool.query(
      `INSERT INTO deliveries
        (id, station_id, delivery_date, delivery_time, customer_id, rider_id, prod_id,
         qty, amount, status, paid, pay_mode, note)
       VALUES ('da1', ?, CURDATE(), '09:00', 'ca1', 'ra1', 'pa1', 1, 10, 'Pending', 0, '', '')`,
      [STA],
    )
    await pool.query(
      `INSERT INTO utang (id, station_id, ts, customer_id, amount, note, delivery_id)
       VALUES ('ua1', ?, CURDATE(), 'ca1', 10, 'test', 'da1')`,
      [STA],
    )
    await pool.query(
      `INSERT INTO payments (id, station_id, ts, customer_id, amount, note, mode)
       VALUES ('pay_a', ?, CURDATE(), 'ca1', 5, '', 'Cash')`,
      [STA],
    )
  })

  afterAll(async () => {
    if (ready) {
      const pool = getPool()
      await pool.query('DELETE FROM payments WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM utang WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM deliveries WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM riders WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM customers WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM products WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM users WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM settings WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM inventory WHERE station_id IN (?, ?)', [STA, STB])
      await pool.query('DELETE FROM stations WHERE id IN (?, ?)', [STA, STB])
    }
    await closePool()
  })

  it('cascades customer delete within station', async ({ skip }) => {
    if (!ready) skip()
    const conn = await getPool().getConnection()
    try {
      await conn.beginTransaction()
      const ok = await deleteCustomerCascade(conn, STA, 'ca1')
      expect(ok).toBe(true)
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }

    const [custActive] = await getPool().query(
      `SELECT id FROM customers WHERE id = 'ca1' AND station_id = ? AND deleted_at IS NULL`,
      [STA],
    )
    expect((custActive as unknown[]).length).toBe(0)

    const [custSoft] = await getPool().query(
      `SELECT id FROM customers WHERE id = 'ca1' AND station_id = ? AND deleted_at IS NOT NULL`,
      [STA],
    )
    expect((custSoft as unknown[]).length).toBe(1)

    const [dels] = await getPool().query(
      `SELECT id FROM deliveries WHERE customer_id = 'ca1' AND station_id = ? AND deleted_at IS NULL`,
      [STA],
    )
    const [utang] = await getPool().query(
      `SELECT id FROM utang WHERE customer_id = 'ca1' AND station_id = ? AND deleted_at IS NULL`,
      [STA],
    )
    const [pays] = await getPool().query(
      `SELECT id FROM payments WHERE customer_id = 'ca1' AND station_id = ? AND deleted_at IS NULL`,
      [STA],
    )
    expect((dels as unknown[]).length).toBe(0)
    expect((utang as unknown[]).length).toBe(0)
    expect((pays as unknown[]).length).toBe(0)
  })

  it('does not leak station B product when querying with station A filter', async ({
    skip,
  }) => {
    if (!ready) skip()
    const [rows] = await getPool().query(
      `SELECT id FROM products WHERE id = 'pb1' AND station_id = ?`,
      [STA],
    )
    expect((rows as unknown[]).length).toBe(0)

    const [own] = await getPool().query(
      `SELECT id FROM products WHERE id = 'pb1' AND station_id = ?`,
      [STB],
    )
    expect((own as unknown[]).length).toBe(1)
  })
})
