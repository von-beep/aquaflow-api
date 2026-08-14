import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { badRequest, stationId } from '../lib/http.js'
import {
  deleteQrPhFile,
  qrPhPublicPath,
  saveQrPhDataUrl,
} from '../lib/qrph.js'

type SettingsRow = RowDataPacket & {
  station_name: string
  owner: string
  phone: string
  address: string
  lat: number | string | null
  lng: number | string | null
  currency: string
  qrph_path: string | null
}

function parseCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapSettings(row: SettingsRow | undefined) {
  if (!row) {
    return {
      stationName: '',
      owner: '',
      phone: '',
      address: '',
      lat: null as number | null,
      lng: null as number | null,
      currency: '₱',
      qrPhUrl: null as string | null,
    }
  }
  return {
    stationName: row.station_name,
    owner: row.owner,
    phone: row.phone,
    address: row.address ?? '',
    lat: parseCoord(row.lat),
    lng: parseCoord(row.lng),
    currency: row.currency,
    qrPhUrl: qrPhPublicPath(row.qrph_path),
  }
}

export const settingsRouter = Router()

settingsRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<SettingsRow[]>(
    `SELECT station_name, owner, phone, address, lat, lng, currency, qrph_path
     FROM settings WHERE station_id = ? LIMIT 1`,
    [sid],
  )
  res.json({ settings: mapSettings((rows as SettingsRow[])[0]) })
})

settingsRouter.put('/', async (req, res) => {
  const sid = stationId(req)
  const stationName =
    typeof req.body?.stationName === 'string' ? req.body.stationName.trim() : ''
  const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
  const lat = parseCoord(req.body?.lat)
  const lng = parseCoord(req.body?.lng)
  const currency =
    typeof req.body?.currency === 'string' ? req.body.currency.trim() || '₱' : '₱'

  if ((lat == null) !== (lng == null)) {
    badRequest(res, 'lat and lng must both be set or both cleared')
    return
  }

  await getPool().query<ResultSetHeader>(
    `INSERT INTO settings (station_id, station_name, owner, phone, address, lat, lng, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       station_name = VALUES(station_name),
       owner = VALUES(owner),
       phone = VALUES(phone),
       address = VALUES(address),
       lat = VALUES(lat),
       lng = VALUES(lng),
       currency = VALUES(currency),
       updated_at = UTC_TIMESTAMP(3)`,
    [sid, stationName, owner, phone, address, lat, lng, currency],
  )
  await getPool().query(
    `UPDATE stations SET name = ?, phone = ?, address = ?, lat = ?, lng = ? WHERE id = ?`,
    [stationName || 'Station', phone, address, lat, lng, sid],
  )

  const [rows] = await getPool().query<SettingsRow[]>(
    `SELECT station_name, owner, phone, address, lat, lng, currency, qrph_path
     FROM settings WHERE station_id = ? LIMIT 1`,
    [sid],
  )
  res.json({ settings: mapSettings((rows as SettingsRow[])[0]) })
})

/** Upload QR Ph image (PNG/JPEG/WebP data URL). */
settingsRouter.post('/qrph', async (req, res) => {
  const sid = stationId(req)
  const image =
    typeof req.body?.image === 'string' ? req.body.image.trim() : ''
  if (!image) {
    badRequest(res, 'image data URL is required')
    return
  }

  let relative: string
  try {
    relative = await saveQrPhDataUrl(sid, image)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    if (code === 'image_too_large') {
      badRequest(res, 'Image is too large (max ~800KB)')
      return
    }
    badRequest(res, 'Invalid image — use PNG, JPEG, or WebP')
    return
  }

  const [existing] = await getPool().query<SettingsRow[]>(
    `SELECT qrph_path FROM settings WHERE station_id = ? LIMIT 1`,
    [sid],
  )
  const prev = (existing as SettingsRow[])[0]?.qrph_path
  if (prev && prev !== relative) {
    await deleteQrPhFile(prev)
  }

  await getPool().query<ResultSetHeader>(
    `INSERT INTO settings (station_id, station_name, owner, phone, currency, qrph_path)
     VALUES (?, '', '', '', '₱', ?)
     ON DUPLICATE KEY UPDATE
       qrph_path = VALUES(qrph_path),
       updated_at = UTC_TIMESTAMP(3)`,
    [sid, relative],
  )

  res.json({ qrPhUrl: qrPhPublicPath(relative) })
})

settingsRouter.delete('/qrph', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<SettingsRow[]>(
    `SELECT qrph_path FROM settings WHERE station_id = ? LIMIT 1`,
    [sid],
  )
  const prev = (rows as SettingsRow[])[0]?.qrph_path ?? null
  await deleteQrPhFile(prev)
  await getPool().query(
    `UPDATE settings SET qrph_path = NULL, updated_at = UTC_TIMESTAMP(3)
     WHERE station_id = ?`,
    [sid],
  )
  res.json({ qrPhUrl: null })
})
