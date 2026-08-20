import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { parseHm, toMysqlTime } from '../lib/hours.js'
import { badRequest, stationId } from '../lib/http.js'
import {
  deletePaymentQrFile,
  isPaymentQrMethod,
  paymentQrPublicPath,
  savePaymentQrDataUrl,
  type PaymentQrMethod,
} from '../lib/qrph.js'

type SettingsRow = RowDataPacket & {
  station_name: string
  owner: string
  phone: string
  address: string
  lat: number | string | null
  lng: number | string | null
  currency: string
  open_time: unknown
  close_time: unknown
  qrph_path: string | null
  gcash_qr_path: string | null
  maya_qr_path: string | null
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
      openTime: null as string | null,
      closeTime: null as string | null,
      gcashQrUrl: null as string | null,
      mayaQrUrl: null as string | null,
    }
  }
  const gcash =
    paymentQrPublicPath(row.gcash_qr_path) ?? paymentQrPublicPath(row.qrph_path)
  return {
    stationName: row.station_name,
    owner: row.owner,
    phone: row.phone,
    address: row.address ?? '',
    lat: parseCoord(row.lat),
    lng: parseCoord(row.lng),
    currency: row.currency,
    openTime: parseHm(row.open_time),
    closeTime: parseHm(row.close_time),
    gcashQrUrl: gcash,
    mayaQrUrl: paymentQrPublicPath(row.maya_qr_path),
  }
}

const SETTINGS_SELECT = `SELECT station_name, owner, phone, address, lat, lng, currency,
       open_time, close_time, qrph_path, gcash_qr_path, maya_qr_path
     FROM settings WHERE station_id = ? LIMIT 1`

function columnForMethod(method: PaymentQrMethod): 'gcash_qr_path' | 'maya_qr_path' {
  return method === 'gcash' ? 'gcash_qr_path' : 'maya_qr_path'
}

export const settingsRouter = Router()

settingsRouter.get('/', async (req, res) => {
  const sid = stationId(req)
  const [rows] = await getPool().query<SettingsRow[]>(SETTINGS_SELECT, [sid])
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

  let openMysql: string | null
  let closeMysql: string | null
  if ('openTime' in (req.body ?? {}) || 'closeTime' in (req.body ?? {})) {
    const openEmpty =
      req.body?.openTime == null ||
      (typeof req.body.openTime === 'string' && !req.body.openTime.trim())
    const closeEmpty =
      req.body?.closeTime == null ||
      (typeof req.body.closeTime === 'string' && !req.body.closeTime.trim())
    if (openEmpty && closeEmpty) {
      openMysql = null
      closeMysql = null
    } else {
      const open = parseHm(req.body?.openTime)
      const close = parseHm(req.body?.closeTime)
      if (!open || !close) {
        badRequest(res, 'openTime and closeTime must both be valid HH:mm values')
        return
      }
      openMysql = toMysqlTime(open)
      closeMysql = toMysqlTime(close)
    }
  } else {
    const [cur] = await getPool().query<SettingsRow[]>(SETTINGS_SELECT, [sid])
    const row = (cur as SettingsRow[])[0]
    openMysql = toMysqlTime(parseHm(row?.open_time ?? null))
    closeMysql = toMysqlTime(parseHm(row?.close_time ?? null))
  }

  await getPool().query<ResultSetHeader>(
    `INSERT INTO settings (station_id, station_name, owner, phone, address, lat, lng, currency, open_time, close_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       station_name = VALUES(station_name),
       owner = VALUES(owner),
       phone = VALUES(phone),
       address = VALUES(address),
       lat = VALUES(lat),
       lng = VALUES(lng),
       currency = VALUES(currency),
       open_time = VALUES(open_time),
       close_time = VALUES(close_time),
       updated_at = UTC_TIMESTAMP(3)`,
    [sid, stationName, owner, phone, address, lat, lng, currency, openMysql, closeMysql],
  )
  await getPool().query(
    `UPDATE stations SET name = ?, phone = ?, address = ?, lat = ?, lng = ? WHERE id = ?`,
    [stationName || 'Station', phone, address, lat, lng, sid],
  )

  const [rows] = await getPool().query<SettingsRow[]>(SETTINGS_SELECT, [sid])
  res.json({ settings: mapSettings((rows as SettingsRow[])[0]) })
})

/** Upload payment QR for a method: gcash | maya */
settingsRouter.post('/payment-qr/:method', async (req, res) => {
  const sid = stationId(req)
  const methodRaw = String(req.params.method ?? '').toLowerCase()
  if (!isPaymentQrMethod(methodRaw)) {
    badRequest(res, 'method must be gcash or maya')
    return
  }
  const method = methodRaw
  const image = typeof req.body?.image === 'string' ? req.body.image.trim() : ''
  if (!image) {
    badRequest(res, 'image data URL is required')
    return
  }

  let relative: string
  try {
    relative = await savePaymentQrDataUrl(sid, method, image)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    if (code === 'image_too_large') {
      badRequest(res, 'Image is too large (max ~800KB)')
      return
    }
    badRequest(res, 'Invalid image — use PNG, JPEG, or WebP')
    return
  }

  const col = columnForMethod(method)
  const [existing] = await getPool().query<SettingsRow[]>(
    `SELECT ${col} AS path, qrph_path FROM settings WHERE station_id = ? LIMIT 1`,
    [sid],
  )
  const row = (existing as (SettingsRow & { path?: string | null })[])[0]
  const prev = (row?.path as string | null | undefined) ?? null
  if (prev && prev !== relative) {
    await deletePaymentQrFile(prev)
  }
  if (method === 'gcash' && row?.qrph_path && row.qrph_path !== relative) {
    await deletePaymentQrFile(row.qrph_path)
  }

  await getPool().query<ResultSetHeader>(
    `INSERT INTO settings (station_id, station_name, owner, phone, currency, ${col})
     VALUES (?, '', '', '', '₱', ?)
     ON DUPLICATE KEY UPDATE
       ${col} = VALUES(${col}),
       ${method === 'gcash' ? 'qrph_path = NULL,' : ''}
       updated_at = UTC_TIMESTAMP(3)`,
    [sid, relative],
  )

  const url = paymentQrPublicPath(relative)
  res.json({
    method,
    qrUrl: url,
    gcashQrUrl: method === 'gcash' ? url : undefined,
    mayaQrUrl: method === 'maya' ? url : undefined,
  })
})

settingsRouter.delete('/payment-qr/:method', async (req, res) => {
  const sid = stationId(req)
  const methodRaw = String(req.params.method ?? '').toLowerCase()
  if (!isPaymentQrMethod(methodRaw)) {
    badRequest(res, 'method must be gcash or maya')
    return
  }
  const method = methodRaw
  const col = columnForMethod(method)

  const [rows] = await getPool().query<SettingsRow[]>(
    `SELECT ${col} AS path, qrph_path FROM settings WHERE station_id = ? LIMIT 1`,
    [sid],
  )
  const row = (rows as (SettingsRow & { path?: string | null })[])[0]
  const prev = (row?.path as string | null | undefined) ?? null
  await deletePaymentQrFile(prev)
  if (method === 'gcash' && row?.qrph_path) {
    await deletePaymentQrFile(row.qrph_path)
  }

  await getPool().query(
    `UPDATE settings SET ${col} = NULL${
      method === 'gcash' ? ', qrph_path = NULL' : ''
    }, updated_at = UTC_TIMESTAMP(3)
     WHERE station_id = ?`,
    [sid],
  )
  res.json({ method, qrUrl: null })
})
