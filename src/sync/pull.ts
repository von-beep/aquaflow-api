import type { Pool, RowDataPacket } from 'mysql2/promise'
import { toDateOnlyString } from '../lib/dates.js'
import {
  ENTITY_COLLECTIONS,
  SINGLETON_COLLECTIONS,
  toIso,
  type SyncCollection,
} from './types.js'

export type SyncRecord = {
  collection: SyncCollection
  id: string
  updatedAt: string
  deletedAt: string | null
  data: Record<string, unknown> | null
}

function mapProduct(r: RowDataPacket): Record<string, unknown> {
  return { name: r.name, price: Number(r.price) }
}

function mapCustomer(r: RowDataPacket): Record<string, unknown> {
  return {
    name: r.name,
    phone: r.phone,
    addr: r.addr,
    gallonsOut: Number(r.gallons_out),
    note: r.note,
  }
}

function mapRider(r: RowDataPacket): Record<string, unknown> {
  return { name: r.name, phone: r.phone }
}

function mapDelivery(r: RowDataPacket): Record<string, unknown> {
  const date = toDateOnlyString(r.delivery_date as Date | string) ?? ''
  return {
    date,
    time: r.delivery_time,
    customerId: r.customer_id,
    riderId: r.rider_id,
    prodId: r.prod_id,
    qty: Number(r.qty),
    amount: Number(r.amount),
    status: r.status,
    paid: Boolean(r.paid),
    payMode: r.pay_mode,
    note: r.note,
  }
}

function mapUtang(r: RowDataPacket): Record<string, unknown> {
  const ts =
    typeof r.ts === 'string' ? r.ts.slice(0, 10) : new Date(r.ts).toISOString().slice(0, 10)
  return {
    ts,
    customerId: r.customer_id,
    amount: Number(r.amount),
    note: r.note,
    deliveryId: r.delivery_id ?? undefined,
  }
}

function mapPayment(r: RowDataPacket): Record<string, unknown> {
  const ts =
    typeof r.ts === 'string' ? r.ts.slice(0, 10) : new Date(r.ts).toISOString().slice(0, 10)
  return {
    ts,
    customerId: r.customer_id,
    amount: Number(r.amount),
    note: r.note,
    mode: r.mode,
  }
}

function mapSettings(r: RowDataPacket): Record<string, unknown> {
  const lat = r.lat == null || r.lat === '' ? null : Number(r.lat)
  const lng = r.lng == null || r.lng === '' ? null : Number(r.lng)
  const openRaw = r.open_time
  const closeRaw = r.close_time
  const openTime =
    openRaw == null || openRaw === ''
      ? null
      : typeof openRaw === 'string'
        ? openRaw.slice(0, 5)
        : openRaw instanceof Date
          ? `${String(openRaw.getUTCHours()).padStart(2, '0')}:${String(openRaw.getUTCMinutes()).padStart(2, '0')}`
          : null
  const closeTime =
    closeRaw == null || closeRaw === ''
      ? null
      : typeof closeRaw === 'string'
        ? closeRaw.slice(0, 5)
        : closeRaw instanceof Date
          ? `${String(closeRaw.getUTCHours()).padStart(2, '0')}:${String(closeRaw.getUTCMinutes()).padStart(2, '0')}`
          : null
  return {
    stationName: r.station_name,
    owner: r.owner,
    phone: r.phone,
    address: r.address ?? '',
    lat: Number.isFinite(lat as number) ? lat : null,
    lng: Number.isFinite(lng as number) ? lng : null,
    currency: r.currency,
    openTime,
    closeTime,
  }
}

function mapInventory(r: RowDataPacket): Record<string, unknown> {
  return { full: Number(r.full_count), empty: Number(r.empty_count) }
}

const ENTITY_SQL: Record<
  (typeof ENTITY_COLLECTIONS)[number],
  { select: string; map: (r: RowDataPacket) => Record<string, unknown> }
> = {
  products: {
    select: 'id, name, price, updated_at, deleted_at',
    map: mapProduct,
  },
  customers: {
    select: 'id, name, phone, addr, gallons_out, note, updated_at, deleted_at',
    map: mapCustomer,
  },
  riders: {
    select: 'id, name, phone, updated_at, deleted_at',
    map: mapRider,
  },
  deliveries: {
    select:
      'id, delivery_date, delivery_time, customer_id, rider_id, prod_id, qty, amount, status, paid, pay_mode, note, updated_at, deleted_at',
    map: mapDelivery,
  },
  utang: {
    select: 'id, ts, customer_id, amount, note, delivery_id, updated_at, deleted_at',
    map: mapUtang,
  },
  payments: {
    select: 'id, ts, customer_id, amount, note, mode, updated_at, deleted_at',
    map: mapPayment,
  },
}

export async function pullChanges(
  pool: Pool,
  stationId: string,
  since: Date,
): Promise<{ serverTime: string; records: SyncRecord[] }> {
  const sinceSql = since.toISOString().slice(0, 23).replace('T', ' ')
  const records: SyncRecord[] = []

  for (const collection of ENTITY_COLLECTIONS) {
    const cfg = ENTITY_SQL[collection]
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${cfg.select}
       FROM ${collection}
       WHERE station_id = ?
         AND (updated_at > ? OR (deleted_at IS NOT NULL AND deleted_at > ?))
       ORDER BY updated_at ASC`,
      [stationId, sinceSql, sinceSql],
    )
    for (const r of rows as RowDataPacket[]) {
      const deletedAt = toIso(r.deleted_at as Date | string | null)
      records.push({
        collection,
        id: String(r.id),
        updatedAt: toIso(r.updated_at as Date | string) ?? new Date().toISOString(),
        deletedAt,
        data: deletedAt ? null : cfg.map(r),
      })
    }
  }

  for (const collection of SINGLETON_COLLECTIONS) {
    if (collection === 'settings') {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT station_id, station_name, owner, phone, address, lat, lng, currency,
                open_time, close_time, updated_at
         FROM settings WHERE station_id = ? AND updated_at > ? LIMIT 1`,
        [stationId, sinceSql],
      )
      const r = (rows as RowDataPacket[])[0]
      if (r) {
        records.push({
          collection: 'settings',
          id: stationId,
          updatedAt: toIso(r.updated_at as Date | string) ?? new Date().toISOString(),
          deletedAt: null,
          data: mapSettings(r),
        })
      }
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT station_id, full_count, empty_count, updated_at
         FROM inventory WHERE station_id = ? AND updated_at > ? LIMIT 1`,
        [stationId, sinceSql],
      )
      const r = (rows as RowDataPacket[])[0]
      if (r) {
        records.push({
          collection: 'inventory',
          id: stationId,
          updatedAt: toIso(r.updated_at as Date | string) ?? new Date().toISOString(),
          deletedAt: null,
          data: mapInventory(r),
        })
      }
    }
  }

  const [timeRows] = await pool.query<RowDataPacket[]>('SELECT UTC_TIMESTAMP(3) AS t')
  const serverTime =
    toIso((timeRows as RowDataPacket[])[0]?.t as Date | string) ?? new Date().toISOString()

  return { serverTime, records }
}
