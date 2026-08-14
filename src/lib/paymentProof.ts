import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { UPLOADS_ROOT } from './qrph.js'

const MAX_BYTES = 900_000
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
}

export function paymentProofPublicPath(
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath || typeof relativePath !== 'string') return null
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!cleaned.startsWith('payment-proofs/')) return null
  return `/uploads/${cleaned}`
}

/** Save checkout payment screenshot → uploads/payment-proofs/{stationId}/{orderId}.{ext} */
export async function savePaymentProofDataUrl(
  stationId: string,
  orderId: string,
  dataUrl: string,
): Promise<string> {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl.trim())
  if (!m) throw new Error('invalid_image')
  const mime = m[1]!.toLowerCase()
  const ext = ALLOWED[mime]
  if (!ext) throw new Error('invalid_image')
  const buf = Buffer.from(m[2]!, 'base64')
  if (buf.length === 0 || buf.length > MAX_BYTES) {
    throw new Error('image_too_large')
  }

  const safeStation = stationId.replace(/[^a-zA-Z0-9_-]/g, '')
  const safeOrder = orderId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeStation || !safeOrder) throw new Error('invalid_image')

  const dir = path.join(UPLOADS_ROOT, 'payment-proofs', safeStation)
  await mkdir(dir, { recursive: true })
  const relative = `payment-proofs/${safeStation}/${safeOrder}.${ext}`
  await writeFile(path.join(UPLOADS_ROOT, relative), buf)
  return relative
}
