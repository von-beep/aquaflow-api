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

export function qrPhPublicPath(relativePath: string | null | undefined): string | null {
  if (!relativePath || typeof relativePath !== 'string') return null
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!cleaned.startsWith('qrph/')) return null
  return `/uploads/${cleaned}`
}

/** Parse a data URL and write to uploads/qrph/{stationId}.{ext}. Returns relative path. */
export async function saveQrPhDataUrl(
  stationId: string,
  dataUrl: string,
): Promise<string> {
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

  const dir = path.join(UPLOADS_ROOT, 'qrph')
  await mkdir(dir, { recursive: true })

  // Remove previous extensions for this station.
  for (const oldExt of Object.values(ALLOWED)) {
    try {
      await unlink(path.join(dir, `${stationId}.${oldExt}`))
    } catch {
      /* ignore missing */
    }
  }

  const relative = `qrph/${stationId}.${ext}`
  await writeFile(path.join(UPLOADS_ROOT, relative), buf)
  return relative
}

export async function deleteQrPhFile(
  relativePath: string | null | undefined,
): Promise<void> {
  if (!relativePath) return
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!cleaned.startsWith('qrph/')) return
  try {
    await unlink(path.join(UPLOADS_ROOT, cleaned))
  } catch {
    /* ignore missing */
  }
}
