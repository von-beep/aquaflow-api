import { Router } from 'express'

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'AquaFlow/0.1 (water-refilling station manager; localhost)'

/** Minimal spacing so we don't hammer Nominatim from the proxy. */
let lastFetchAt = 0

async function nominatimFetch(path: string): Promise<unknown> {
  const wait = 1100 - (Date.now() - lastFetchAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastFetchAt = Date.now()

  const res = await fetch(`${NOMINATIM}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })
  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * Public geocoding proxy (OSM Nominatim) for station address search / reverse.
 * Keeps User-Agent server-side and avoids browser CORS issues.
 */
export const geocodeRouter = Router()

geocodeRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (q.length < 3) {
    res.status(400).json({ error: 'bad_request', message: 'q must be at least 3 characters' })
    return
  }
  try {
    const data = await nominatimFetch(
      `/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`,
    )
    const rows = Array.isArray(data) ? data : []
    res.json({
      results: rows.map((r: Record<string, unknown>) => ({
        displayName: String(r.display_name ?? ''),
        lat: Number(r.lat),
        lng: Number(r.lon),
      })),
    })
  } catch (err) {
    console.error(err)
    res.status(502).json({ error: 'geocode_error', message: 'Address search failed' })
  }
})

geocodeRouter.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'bad_request', message: 'lat and lng are required' })
    return
  }
  try {
    const data = (await nominatimFetch(
      `/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`,
    )) as Record<string, unknown>
    res.json({
      displayName: String(data.display_name ?? ''),
      lat,
      lng,
    })
  } catch (err) {
    console.error(err)
    res.status(502).json({ error: 'geocode_error', message: 'Reverse geocode failed' })
  }
})
