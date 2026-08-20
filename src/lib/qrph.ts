import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Project-root uploads/ (sibling of src/). */
export const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads')

const MAX_BYTES = 800_000
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
}

/** @deprecated Fixed-slot era — prefer free-form slug strings. */
export type PaymentQrMethod = 'gcash' | 'maya'

export function isPaymentQrMethod(value: string): value is PaymentQrMethod {
  return value === 'gcash' || value === 'maya'
}

export function sanitizePaymentSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 32)
}

export function slugifyPaymentName(name: string): string {
  return sanitizePaymentSlug(name)
}

/** Public URL for a stored QR path (legacy qrph/ or payment-qr/). */
export function paymentQrPublicPath(
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath || typeof relativePath !== 'string') return null
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!cleaned.startsWith('qrph/') && !cleaned.startsWith('payment-qr/')) {
    return null
  }
  return `/uploads/${cleaned}`
}

/** @deprecated Use paymentQrPublicPath */
export function qrPhPublicPath(
  relativePath: string | null | undefined,
): string | null {
  return paymentQrPublicPath(relativePath)
}

export async function savePaymentQrDataUrl(
  stationId: string,
  methodSlug: string,
  dataUrl: string,
): Promise<string> {
  const slug = sanitizePaymentSlug(methodSlug)
  if (!slug) throw new Error('invalid_method')

  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl.trim())
  if (!m) {
    throw new Error('invalid_image')
  }
  const mime = m[1]!.toLowerCase()
  const ext = ALLOWED[mime]
  if (!ext) throw new Error('invalid_image')
  const buf = Buffer.from(m[2]!, 'base64')
  if (buf.length === 0 || buf.length > MAX_BYTES) {
    throw new Error('image_too_large')
  }

  const dir = path.join(UPLOADS_ROOT, 'payment-qr', slug)
  await mkdir(dir, { recursive: true })

  for (const oldExt of Object.values(ALLOWED)) {
    try {
      await unlink(path.join(dir, `${stationId}.${oldExt}`))
    } catch {
      /* ignore missing */
    }
  }

  const relative = `payment-qr/${slug}/${stationId}.${ext}`
  await writeFile(path.join(UPLOADS_ROOT, relative), buf)
  return relative
}

/** @deprecated Prefer savePaymentQrDataUrl(stationId, 'gcash', …) */
export async function saveQrPhDataUrl(
  stationId: string,
  dataUrl: string,
): Promise<string> {
  return savePaymentQrDataUrl(stationId, 'gcash', dataUrl)
}

export async function deletePaymentQrFile(
  relativePath: string | null | undefined,
): Promise<void> {
  if (!relativePath) return
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!cleaned.startsWith('qrph/') && !cleaned.startsWith('payment-qr/')) return
  try {
    await unlink(path.join(UPLOADS_ROOT, cleaned))
  } catch {
    /* ignore missing */
  }
}

/** @deprecated Use deletePaymentQrFile */
export async function deleteQrPhFile(
  relativePath: string | null | undefined,
): Promise<void> {
  return deletePaymentQrFile(relativePath)
}
