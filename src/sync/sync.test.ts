import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, getPool, waitForDb } from '../db/pool.js'
import { pullChanges } from '../sync/pull.js'
import { pushMutations } from '../sync/push.js'
import { uid } from '../lib/ids.js'

const STA = 's_sync_a'
const STB = 's_sync_b'

async function ready(): Promise<boolean> {
  try {
    await waitForDb({ attempts: 5, delayMs: 500 })
    const [rows] = await getPool().query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'updated_at'`,
    )
    return Number((rows as { cnt: number }[])[0]?.cnt) === 1
  } catch {
    return false
  }
}

describe('sync pull/push', () => {
  let ok = false

  beforeAll(async () => {
    ok = await ready()
    if (!ok) return
    const pool = getPool()
    for (const sid of [STA, STB]) {
      await pool.query('DELETE FROM products WHERE station_id = ?', [sid])
      await pool.query('DELETE FROM users WHERE station_id = ?', [sid])
      await pool.query('DELETE FROM settings WHERE station_id = ?', [sid])
      await pool.query('DELETE FROM inventory WHERE station_id = ?', [sid])
      await pool.query('DELETE FROM stations WHERE id = ?', [sid])
    }
    await pool.query(
      `INSERT INTO stations (id, name, slug, plan_status) VALUES
       (?, 'Sync A', 'sync-a', 'trial'),
       (?, 'Sync B', 'sync-b', 'trial')`,
      [STA, STB],
    )
  })

  afterAll(async () => {
    if (ok) {
      const pool = getPool()
      for (const sid of [STA, STB]) {
        await pool.query('DELETE FROM products WHERE station_id = ?', [sid])
        await pool.query('DELETE FROM stations WHERE id = ?', [sid])
      }
    }
    await closePool()
  })

  it('same station: push then pull converges', async ({ skip }) => {
    if (!ok) skip()
    const pool = getPool()
    const conn = await pool.getConnection()
    const id = uid()
    const t1 = new Date().toISOString()
    try {
      await conn.beginTransaction()
      const push = await pushMutations(conn, STA, [
        {
          collection: 'products',
          id,
          op: 'upsert',
          updatedAt: t1,
          data: { name: 'Synced Jug', price: 42 },
        },
      ])
      await conn.commit()
      expect(push.applied).toHaveLength(1)
      expect(push.conflicts).toHaveLength(0)
    } finally {
      conn.release()
    }

    const pulled = await pullChanges(pool, STA, new Date(0))
    const rec = pulled.records.find((r) => r.collection === 'products' && r.id === id)
    expect(rec?.data).toMatchObject({ name: 'Synced Jug', price: 42 })
    expect(rec?.deletedAt).toBeNull()
  })

  it('LWW: older client mutation loses', async ({ skip }) => {
    if (!ok) skip()
    const pool = getPool()
    const id = uid()
    const older = '2020-01-01T00:00:00.000Z'
    const newer = '2026-01-01T00:00:00.000Z'

    const conn1 = await pool.getConnection()
    try {
      await conn1.beginTransaction()
      await pushMutations(conn1, STA, [
        {
          collection: 'products',
          id,
          op: 'upsert',
          updatedAt: newer,
          data: { name: 'New', price: 1 },
        },
      ])
      await conn1.commit()
    } finally {
      conn1.release()
    }

    const conn2 = await pool.getConnection()
    try {
      await conn2.beginTransaction()
      const push = await pushMutations(conn2, STA, [
        {
          collection: 'products',
          id,
          op: 'upsert',
          updatedAt: older,
          data: { name: 'Old', price: 99 },
        },
      ])
      await conn2.commit()
      expect(push.conflicts[0]?.reason).toBe('lww_lost')
    } finally {
      conn2.release()
    }

    const [rows] = await pool.query(
      `SELECT name, price FROM products WHERE id = ? AND station_id = ?`,
      [id, STA],
    )
    expect((rows as { name: string; price: number }[])[0].name).toBe('New')
  })

  it('cross-station pull does not leak', async ({ skip }) => {
    if (!ok) skip()
    const pool = getPool()
    const id = uid()
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await pushMutations(conn, STA, [
        {
          collection: 'products',
          id,
          op: 'upsert',
          updatedAt: new Date().toISOString(),
          data: { name: 'Secret A', price: 1 },
        },
      ])
      await conn.commit()
    } finally {
      conn.release()
    }

    const pulledB = await pullChanges(pool, STB, new Date(0))
    expect(pulledB.records.some((r) => r.id === id)).toBe(false)
  })
})
