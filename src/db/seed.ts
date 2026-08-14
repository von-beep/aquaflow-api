import 'dotenv/config'
import bcrypt from 'bcrypt'
import type { RowDataPacket } from 'mysql2'
import { closePool, getPool, waitForDb } from './pool.js'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

type DeliveryStatus = 'Pending' | 'In Progress' | 'Completed' | 'Cancelled'
type SeedPay = 'Cash' | 'GCash' | 'Utang' | null

const DEMO_STATION_ID = 's_demo'
const DEMO_OWNER_EMAIL = 'owner@demo.local'
const DEMO_OWNER_PASSWORD = 'password123'
const PLATFORM_STATION_ID = 's_platform'
const PLATFORM_ADMIN_EMAIL = 'admin@aquaflow.local'
const PLATFORM_ADMIN_PASSWORD = 'password123'

async function assertSchemaReady(): Promise<void> {
  const pool = getPool()
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (
         'stations', 'users',
         'settings', 'inventory', 'products', 'customers',
         'riders', 'deliveries', 'utang', 'payments'
       )`,
  )
  const cnt = Number((rows as RowDataPacket[])[0]?.cnt ?? 0)
  if (cnt < 10) {
    throw new Error(
      'Database tables missing. Run `npm run migrate` before `npm run seed` (Phase 7 schema required).',
    )
  }
}

/** Demo data mirrored from Aquaflow frontend `src/domain/seed.ts`, under one station. */
export async function seed(): Promise<void> {
  await waitForDb()
  await assertSchemaReady()

  const pool = getPool()
  const conn = await pool.getConnection()

  const products = [
    { id: 'p1', name: 'Slim Gallon Refill (5gal)', price: 25 },
    { id: 'p2', name: 'Round Gallon Refill (5gal)', price: 30 },
    { id: 'p3', name: 'New Slim Container + Refill', price: 180 },
    { id: 'p4', name: 'Mineral Bottled (500ml x12)', price: 90 },
  ]

  const customers = [
    {
      id: 'c1',
      name: 'Maria Santos',
      phone: '0917 111 2233',
      addr: 'Phase 2, Block 12',
      gallonsOut: 3,
      note: 'MWF delivery',
    },
    {
      id: 'c2',
      name: 'Juan Dela Cruz',
      phone: '0918 222 3344',
      addr: 'Mabini St.',
      gallonsOut: 2,
      note: '',
    },
    {
      id: 'c3',
      name: 'Ana Reyes',
      phone: '0919 333 4455',
      addr: 'Purok 5',
      gallonsOut: 4,
      note: 'Carinderia — daily',
    },
    {
      id: 'c4',
      name: 'Pedro Mendoza',
      phone: '0920 444 5566',
      addr: 'Rizal Ave.',
      gallonsOut: 2,
      note: '',
    },
    {
      id: 'c5',
      name: 'Liza Ramos',
      phone: '0921 555 6677',
      addr: 'Phase 1, Block 3',
      gallonsOut: 1,
      note: '',
    },
  ]

  const riders = [
    { id: 'r1', name: 'Mark', phone: '' },
    { id: 'r2', name: 'Leo', phone: '' },
    { id: 'r3', name: 'Carlo', phone: '' },
  ]

  type DeliveryRow = {
    id: string
    date: string
    time: string
    customerId: string
    riderId: string
    prodId: string
    qty: number
    amount: number
    status: DeliveryStatus
    paid: boolean
    payMode: 'Cash' | 'GCash' | ''
    note: string
  }

  type UtangRow = {
    id: string
    ts: string
    customerId: string
    amount: number
    note: string
    deliveryId: string
  }

  const deliveries: DeliveryRow[] = []
  const utang: UtangRow[] = []

  const mk = (
    dAgo: number,
    time: string,
    cI: number,
    rI: number,
    pI: number,
    qty: number,
    status: DeliveryStatus,
    pay: SeedPay,
  ) => {
    const date = daysAgo(dAgo)
    const amount = products[pI].price * qty
    const id = uid()
    deliveries.push({
      id,
      date,
      time,
      customerId: customers[cI].id,
      riderId: riders[rI].id,
      prodId: products[pI].id,
      qty,
      amount,
      status,
      paid: Boolean(pay && pay !== 'Utang'),
      payMode: pay && pay !== 'Utang' ? pay : '',
      note: '',
    })
    if (pay === 'Utang') {
      utang.push({
        id: uid(),
        ts: date,
        customerId: customers[cI].id,
        amount,
        note: `${qty}x ${products[pI].name}`,
        deliveryId: id,
      })
    }
  }

  for (let d = 6; d >= 1; d--) {
    mk(d, '08:30', 0, 0, 0, 3, 'Completed', 'Cash')
    mk(d, '09:30', 1, 1, 0, 2, 'Completed', d % 2 ? 'GCash' : 'Utang')
    mk(d, '10:30', 2, 2, 1, 4, 'Completed', 'Cash')
    if (d % 2) mk(d, '14:00', 3, 0, 0, 2, 'Completed', 'Utang')
  }

  mk(0, '08:15', 0, 0, 0, 3, 'Completed', 'Cash')
  mk(0, '09:30', 1, 1, 0, 2, 'In Progress', null)
  mk(0, '10:00', 2, 2, 1, 4, 'Pending', null)
  mk(0, '08:45', 3, 0, 0, 2, 'Completed', 'Utang')
  mk(0, '11:00', 4, 1, 0, 1, 'Pending', null)

  const payments = [
    {
      id: uid(),
      ts: daysAgo(4),
      customerId: 'c2',
      amount: 500,
      note: 'Partial',
      mode: 'Cash' as const,
    },
    {
      id: uid(),
      ts: daysAgo(2),
      customerId: 'c4',
      amount: 300,
      note: '',
      mode: 'GCash' as const,
    },
  ]

  const ownerHash = await bcrypt.hash(DEMO_OWNER_PASSWORD, 10)
  const ownerId = uid()

  try {
    await conn.beginTransaction()

    await conn.query('DELETE FROM payments')
    await conn.query('DELETE FROM utang')
    await conn.query('DELETE FROM deliveries')
    await conn.query('DELETE FROM customers')
    await conn.query('DELETE FROM riders')
    await conn.query('DELETE FROM products')
    await conn.query('DELETE FROM settings')
    await conn.query('DELETE FROM inventory')
    await conn.query('DELETE FROM invites')
    await conn.query('DELETE FROM users')
    await conn.query('DELETE FROM stations')

    await conn.query(
      `INSERT INTO stations (id, name, slug, plan_status)
       VALUES (?, ?, 'demo', 'trial')`,
      [DEMO_STATION_ID, 'AquaFlow Purified Water'],
    )
    await conn.query(
      `INSERT INTO stations (id, name, slug, plan_status)
       VALUES (?, ?, 'platform', 'active')`,
      [PLATFORM_STATION_ID, 'AquaFlow Platform'],
    )
    await conn.query(
      `INSERT INTO users (id, station_id, email, password_hash, role, is_platform_admin)
       VALUES (?, ?, ?, ?, 'owner', 0)`,
      [ownerId, DEMO_STATION_ID, DEMO_OWNER_EMAIL, ownerHash],
    )
    const platformAdminId = uid()
    const platformHash = await bcrypt.hash(PLATFORM_ADMIN_PASSWORD, 10)
    await conn.query(
      `INSERT INTO users (id, station_id, email, password_hash, role, is_platform_admin)
       VALUES (?, ?, ?, ?, 'owner', 1)`,
      [platformAdminId, PLATFORM_STATION_ID, PLATFORM_ADMIN_EMAIL, platformHash],
    )
    await conn.query(
      `INSERT INTO settings (station_id, station_name, owner, phone, currency)
       VALUES (?, ?, ?, ?, ?)`,
      [DEMO_STATION_ID, 'AquaFlow Purified Water', '', '0917 000 0000', '₱'],
    )
    await conn.query(
      `INSERT INTO settings (station_id, station_name, owner, phone, currency)
       VALUES (?, ?, ?, ?, ?)`,
      [PLATFORM_STATION_ID, 'AquaFlow Platform', '', '', '₱'],
    )
    await conn.query(
      `INSERT INTO inventory (station_id, full_count, empty_count) VALUES (?, ?, ?)`,
      [DEMO_STATION_ID, 350, 76],
    )
    await conn.query(
      `INSERT INTO inventory (station_id, full_count, empty_count) VALUES (?, ?, ?)`,
      [PLATFORM_STATION_ID, 0, 0],
    )

    for (const p of products) {
      await conn.query(
        `INSERT INTO products (id, station_id, name, price) VALUES (?, ?, ?, ?)`,
        [p.id, DEMO_STATION_ID, p.name, p.price],
      )
    }
    for (const c of customers) {
      await conn.query(
        `INSERT INTO customers (id, station_id, name, phone, addr, gallons_out, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [c.id, DEMO_STATION_ID, c.name, c.phone, c.addr, c.gallonsOut, c.note],
      )
    }
    for (const r of riders) {
      await conn.query(
        `INSERT INTO riders (id, station_id, name, phone) VALUES (?, ?, ?, ?)`,
        [r.id, DEMO_STATION_ID, r.name, r.phone],
      )
    }
    for (const d of deliveries) {
      await conn.query(
        `INSERT INTO deliveries
          (id, order_id, station_id, delivery_date, delivery_time, customer_id, rider_id, prod_id,
           qty, amount, status, paid, pay_mode, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.id,
          d.id,
          DEMO_STATION_ID,
          d.date,
          d.time,
          d.customerId,
          d.riderId,
          d.prodId,
          d.qty,
          d.amount,
          d.status,
          d.paid ? 1 : 0,
          d.payMode,
          d.note,
        ],
      )
    }
    for (const u of utang) {
      await conn.query(
        `INSERT INTO utang (id, station_id, ts, customer_id, amount, note, delivery_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [u.id, DEMO_STATION_ID, u.ts, u.customerId, u.amount, u.note, u.deliveryId],
      )
    }
    for (const p of payments) {
      await conn.query(
        `INSERT INTO payments (id, station_id, ts, customer_id, amount, note, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.id, DEMO_STATION_ID, p.ts, p.customerId, p.amount, p.note, p.mode],
      )
    }

    await conn.commit()
    console.log(
      `Seeded station ${DEMO_STATION_ID}: ${products.length} products, ${customers.length} customers, ${riders.length} riders, ${deliveries.length} deliveries, ${utang.length} utang, ${payments.length} payments`,
    )
    console.log(`Demo login: ${DEMO_OWNER_EMAIL} / ${DEMO_OWNER_PASSWORD}`)
    console.log(`Platform admin: ${PLATFORM_ADMIN_EMAIL} / ${PLATFORM_ADMIN_PASSWORD}`)
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

seed()
  .then(async () => {
    await closePool()
  })
  .catch(async (err: unknown) => {
    console.error(err)
    await closePool()
    process.exit(1)
  })
