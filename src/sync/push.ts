import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  isEntityCollection,
  isSingletonCollection,
  toIso,
  type SyncCollection,
} from './types.js'

export type PushMutation = {
  collection: SyncCollection
  id: string
  op: 'upsert' | 'delete'
  updatedAt: string
  data?: Record<string, unknown>
}

export type PushConflict = {
  collection: SyncCollection
  id: string
  reason: 'lww_lost' | 'invalid'
  serverUpdatedAt: string | null
  message: string
}

export type PushResult = {
  applied: { collection: SyncCollection; id: string; op: string }[]
  conflicts: PushConflict[]
}

function clientWins(clientAt: Date, serverAt: Date | null): boolean {
  if (!serverAt) return true
  return clientAt.getTime() >= serverAt.getTime()
}

function asDate(iso: string): Date {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error('invalid updatedAt')
  return d
}

function sqlTs(d: Date): string {
  return d.toISOString().slice(0, 23).replace('T', ' ')
}

async function loadEntityMeta(
  conn: PoolConnection,
  table: string,
  stationId: string,
  id: string,
): Promise<{ updated_at: Date; deleted_at: Date | null } | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT updated_at, deleted_at FROM ${table} WHERE id = ? AND station_id = ? LIMIT 1`,
    [id, stationId],
  )
  const r = (rows as RowDataPacket[])[0]
  if (!r) return null
  return {
    updated_at: new Date(r.updated_at as string | Date),
    deleted_at: r.deleted_at ? new Date(r.deleted_at as string | Date) : null,
  }
}

async function upsertProduct(
  conn: PoolConnection,
  stationId: string,
  id: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  const name = String(data.name ?? '')
  const price = Number(data.price)
  await conn.query(
    `INSERT INTO products (id, station_id, name, price, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       price = VALUES(price),
       updated_at = VALUES(updated_at),
       deleted_at = NULL`,
    [id, stationId, name, price, sqlTs(updatedAt)],
  )
}

async function upsertCustomer(
  conn: PoolConnection,
  stationId: string,
  id: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  await conn.query(
    `INSERT INTO customers (id, station_id, name, phone, addr, gallons_out, note, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), phone = VALUES(phone), addr = VALUES(addr),
       gallons_out = VALUES(gallons_out), note = VALUES(note),
       updated_at = VALUES(updated_at), deleted_at = NULL`,
    [
      id,
      stationId,
      String(data.name ?? ''),
      String(data.phone ?? ''),
      String(data.addr ?? ''),
      Number(data.gallonsOut ?? 0),
      String(data.note ?? ''),
      sqlTs(updatedAt),
    ],
  )
}

async function upsertRider(
  conn: PoolConnection,
  stationId: string,
  id: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  await conn.query(
    `INSERT INTO riders (id, station_id, name, phone, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), phone = VALUES(phone),
       updated_at = VALUES(updated_at), deleted_at = NULL`,
    [id, stationId, String(data.name ?? ''), String(data.phone ?? ''), sqlTs(updatedAt)],
  )
}

async function upsertDelivery(
  conn: PoolConnection,
  stationId: string,
  id: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  const orderId =
    typeof data.orderId === 'string' && data.orderId.trim()
      ? data.orderId.trim()
      : id
  await conn.query(
    `INSERT INTO deliveries
      (id, order_id, station_id, delivery_date, delivery_time, customer_id, rider_id, prod_id,
       qty, amount, status, paid, pay_mode, note, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       order_id = VALUES(order_id),
       delivery_date = VALUES(delivery_date), delivery_time = VALUES(delivery_time),
       customer_id = VALUES(customer_id), rider_id = VALUES(rider_id), prod_id = VALUES(prod_id),
       qty = VALUES(qty), amount = VALUES(amount), status = VALUES(status),
       paid = VALUES(paid), pay_mode = VALUES(pay_mode), note = VALUES(note),
       updated_at = VALUES(updated_at), deleted_at = NULL`,
    [
      id,
      orderId,
      stationId,
      String(data.date ?? ''),
      String(data.time ?? ''),
      String(data.customerId ?? ''),
      String(data.riderId ?? '') || null,
      String(data.prodId ?? ''),
      Number(data.qty ?? 1),
      Number(data.amount ?? 0),
      String(data.status ?? 'Pending'),
      data.paid ? 1 : 0,
      String(data.payMode ?? ''),
      String(data.note ?? ''),
      sqlTs(updatedAt),
    ],
  )
}

async function upsertUtang(
  conn: PoolConnection,
  stationId: string,
  id: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  await conn.query(
    `INSERT INTO utang (id, station_id, ts, customer_id, amount, note, delivery_id, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       ts = VALUES(ts), customer_id = VALUES(customer_id), amount = VALUES(amount),
       note = VALUES(note), delivery_id = VALUES(delivery_id),
       updated_at = VALUES(updated_at), deleted_at = NULL`,
    [
      id,
      stationId,
      String(data.ts ?? ''),
      String(data.customerId ?? ''),
      Number(data.amount ?? 0),
      String(data.note ?? ''),
      data.deliveryId ? String(data.deliveryId) : null,
      sqlTs(updatedAt),
    ],
  )
}

async function upsertPayment(
  conn: PoolConnection,
  stationId: string,
  id: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  await conn.query(
    `INSERT INTO payments (id, station_id, ts, customer_id, amount, note, mode, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       ts = VALUES(ts), customer_id = VALUES(customer_id), amount = VALUES(amount),
       note = VALUES(note), mode = VALUES(mode),
       updated_at = VALUES(updated_at), deleted_at = NULL`,
    [
      id,
      stationId,
      String(data.ts ?? ''),
      String(data.customerId ?? ''),
      Number(data.amount ?? 0),
      String(data.note ?? ''),
      String(data.mode ?? 'Cash'),
      sqlTs(updatedAt),
    ],
  )
}

async function softDelete(
  conn: PoolConnection,
  table: string,
  stationId: string,
  id: string,
  updatedAt: Date,
): Promise<void> {
  await conn.query<ResultSetHeader>(
    `UPDATE ${table}
     SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND station_id = ?`,
    [sqlTs(updatedAt), sqlTs(updatedAt), id, stationId],
  )
}

function parseCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function upsertSettings(
  conn: PoolConnection,
  stationId: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  const address = String(data.address ?? '')
  const lat = parseCoord(data.lat)
  const lng = parseCoord(data.lng)
  await conn.query(
    `INSERT INTO settings (station_id, station_name, owner, phone, address, lat, lng, currency, open_time, close_time, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       station_name = VALUES(station_name), owner = VALUES(owner),
       phone = VALUES(phone), address = VALUES(address),
       lat = VALUES(lat), lng = VALUES(lng),
       currency = VALUES(currency),
       open_time = VALUES(open_time),
       close_time = VALUES(close_time),
       updated_at = VALUES(updated_at)`,
    [
      stationId,
      String(data.stationName ?? ''),
      String(data.owner ?? ''),
      String(data.phone ?? ''),
      address,
      lat,
      lng,
      String(data.currency ?? '₱'),
      typeof data.openTime === 'string' && data.openTime
        ? `${String(data.openTime).slice(0, 5)}:00`
        : null,
      typeof data.closeTime === 'string' && data.closeTime
        ? `${String(data.closeTime).slice(0, 5)}:00`
        : null,
      sqlTs(updatedAt),
    ],
  )
  await conn.query(
    `UPDATE stations
     SET address = ?, lat = ?, lng = ?,
         name = COALESCE(NULLIF(?, ''), name),
         phone = ?
     WHERE id = ?`,
    [address, lat, lng, String(data.stationName ?? ''), String(data.phone ?? ''), stationId],
  )
}

async function upsertInventory(
  conn: PoolConnection,
  stationId: string,
  updatedAt: Date,
  data: Record<string, unknown>,
): Promise<void> {
  await conn.query(
    `INSERT INTO inventory (station_id, full_count, empty_count, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       full_count = VALUES(full_count), empty_count = VALUES(empty_count),
       updated_at = VALUES(updated_at)`,
    [stationId, Number(data.full ?? 0), Number(data.empty ?? 0), sqlTs(updatedAt)],
  )
}

export async function pushMutations(
  conn: PoolConnection,
  stationId: string,
  mutations: PushMutation[],
): Promise<PushResult> {
  const applied: PushResult['applied'] = []
  const conflicts: PushConflict[] = []

  for (const m of mutations) {
    try {
      const clientAt = asDate(m.updatedAt)

      if (isEntityCollection(m.collection)) {
        const meta = await loadEntityMeta(conn, m.collection, stationId, m.id)
        if (!clientWins(clientAt, meta?.updated_at ?? null)) {
          conflicts.push({
            collection: m.collection,
            id: m.id,
            reason: 'lww_lost',
            serverUpdatedAt: meta ? toIso(meta.updated_at) : null,
            message: 'Server record is newer (last-write-wins)',
          })
          continue
        }

        if (m.op === 'delete') {
          if (!meta) {
            // Already absent — treat as applied tombstone insert via soft row?
            // Insert tombstone-only not supported without full row; mark applied no-op.
            applied.push({ collection: m.collection, id: m.id, op: 'delete' })
            continue
          }
          await softDelete(conn, m.collection, stationId, m.id, clientAt)
          applied.push({ collection: m.collection, id: m.id, op: 'delete' })
          continue
        }

        if (!m.data || typeof m.data !== 'object') {
          conflicts.push({
            collection: m.collection,
            id: m.id,
            reason: 'invalid',
            serverUpdatedAt: meta ? toIso(meta.updated_at) : null,
            message: 'upsert requires data',
          })
          continue
        }

        switch (m.collection) {
          case 'products':
            await upsertProduct(conn, stationId, m.id, clientAt, m.data)
            break
          case 'customers':
            await upsertCustomer(conn, stationId, m.id, clientAt, m.data)
            break
          case 'riders':
            await upsertRider(conn, stationId, m.id, clientAt, m.data)
            break
          case 'deliveries':
            await upsertDelivery(conn, stationId, m.id, clientAt, m.data)
            break
          case 'utang':
            await upsertUtang(conn, stationId, m.id, clientAt, m.data)
            break
          case 'payments':
            await upsertPayment(conn, stationId, m.id, clientAt, m.data)
            break
        }
        applied.push({ collection: m.collection, id: m.id, op: 'upsert' })
        continue
      }

      if (isSingletonCollection(m.collection)) {
        if (m.op === 'delete') {
          conflicts.push({
            collection: m.collection,
            id: m.id,
            reason: 'invalid',
            serverUpdatedAt: null,
            message: 'settings/inventory cannot be deleted via sync',
          })
          continue
        }
        if (m.id !== stationId) {
          conflicts.push({
            collection: m.collection,
            id: m.id,
            reason: 'invalid',
            serverUpdatedAt: null,
            message: 'singleton id must equal stationId',
          })
          continue
        }

        const table = m.collection
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT updated_at FROM ${table} WHERE station_id = ? LIMIT 1`,
          [stationId],
        )
        const serverAt = (rows as RowDataPacket[])[0]
          ? new Date((rows as RowDataPacket[])[0].updated_at as string | Date)
          : null
        if (!clientWins(clientAt, serverAt)) {
          conflicts.push({
            collection: m.collection,
            id: m.id,
            reason: 'lww_lost',
            serverUpdatedAt: toIso(serverAt),
            message: 'Server record is newer (last-write-wins)',
          })
          continue
        }
        if (!m.data) {
          conflicts.push({
            collection: m.collection,
            id: m.id,
            reason: 'invalid',
            serverUpdatedAt: toIso(serverAt),
            message: 'upsert requires data',
          })
          continue
        }
        if (m.collection === 'settings') {
          await upsertSettings(conn, stationId, clientAt, m.data)
        } else {
          await upsertInventory(conn, stationId, clientAt, m.data)
        }
        applied.push({ collection: m.collection, id: m.id, op: 'upsert' })
      }
    } catch (err) {
      conflicts.push({
        collection: m.collection,
        id: m.id,
        reason: 'invalid',
        serverUpdatedAt: null,
        message: err instanceof Error ? err.message : 'push failed',
      })
    }
  }

  return { applied, conflicts }
}
