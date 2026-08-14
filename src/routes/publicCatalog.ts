import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { qrPhPublicPath } from '../lib/qrph.js'
import { PLATFORM_STATION_ID } from '../platform/planRestore.js'

type StationRow = RowDataPacket & {
  id: string
  name: string
  slug: string
  phone: string
  address: string
  lat: number | string | null
  lng: number | string | null
  qrph_path?: string | null
}

function parseCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapStation(r: StationRow) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    phone: r.phone ?? '',
    address: r.address ?? '',
    lat: parseCoord(r.lat),
    lng: parseCoord(r.lng),
    qrPhUrl: qrPhPublicPath(r.qrph_path ?? null),
  }
}

type ProductRow = RowDataPacket & {
  id: string
  name: string
  price: number
}

type SettingsRow = RowDataPacket & {
  currency: string
  qrph_path: string | null
}

/**
 * Public catalog for the marketing landing page.
 * Lists non-platform, non-suspended stations and their products/pricing.
 */
export const publicCatalogRouter = Router()

publicCatalogRouter.get('/stations', async (_req, res) => {
  try {
    const [rows] = await getPool().query<StationRow[]>(
      `SELECT s.id, s.name, s.slug, s.phone, s.address, s.lat, s.lng, st.qrph_path
       FROM stations s
       LEFT JOIN settings st ON st.station_id = s.id
       WHERE s.id <> ?
         AND s.plan_status <> 'suspended'
       ORDER BY s.name`,
      [PLATFORM_STATION_ID],
    )
    res.json({
      stations: (rows as StationRow[]).map(mapStation),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Failed to list stations' })
  }
})

publicCatalogRouter.get('/stations/:idOrSlug/products', async (req, res) => {
  const key = String(req.params.idOrSlug ?? '').trim()
  if (!key) {
    res.status(400).json({ error: 'bad_request', message: 'Station id or slug required' })
    return
  }

  try {
    const [stationRows] = await getPool().query<StationRow[]>(
      `SELECT s.id, s.name, s.slug, s.phone, s.address, s.lat, s.lng
       FROM stations s
       WHERE (s.id = ? OR s.slug = ?)
         AND s.id <> ?
         AND s.plan_status <> 'suspended'
       LIMIT 1`,
      [key, key, PLATFORM_STATION_ID],
    )
    const station = (stationRows as StationRow[])[0]
    if (!station) {
      res.status(404).json({ error: 'not_found', message: 'Station not found' })
      return
    }

    const [settingsResult, productsResult] = await Promise.all([
      getPool().query<SettingsRow[]>(
        `SELECT currency, qrph_path FROM settings WHERE station_id = ? LIMIT 1`,
        [station.id],
      ),
      getPool().query<ProductRow[]>(
        `SELECT id, name, price
         FROM products
         WHERE station_id = ? AND deleted_at IS NULL
         ORDER BY name`,
        [station.id],
      ),
    ])

    const settingsRows = settingsResult[0] as SettingsRow[]
    const productRows = productsResult[0] as ProductRow[]
    const currency = settingsRows[0]?.currency?.trim() || '₱'
    const qrphPath = settingsRows[0]?.qrph_path ?? null

    res.json({
      station: mapStation({ ...station, qrph_path: qrphPath }),
      currency,
      products: productRows.map((r) => ({
        id: r.id,
        name: r.name,
        price: Number(r.price),
      })),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Failed to load products' })
  }
})
