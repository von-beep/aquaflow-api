/**
 * Normalize a MySQL DATE (or Date/string) to `YYYY-MM-DD`.
 * mysql2 returns DATE columns as Date at local midnight; `String(date).slice(0, 10)`
 * yields locale text like "Fri Sep 04", which breaks entitlement parsing.
 * Never use `date.toISOString().slice(0, 10)` for DATE columns in UTC+8 — it shifts
 * the calendar day back by one.
 */
export function toDateOnlyString(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
    return m ? m[1]! : null
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Business calendar for PH stations (Order Now / deliveries "today"). */
export const BUSINESS_TZ = 'Asia/Manila'

/** Current calendar date in Asia/Manila as `YYYY-MM-DD`. */
export function todayInManila(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  if (y && m && d) return `${y}-${m}-${d}`
  return toDateOnlyString(now) ?? now.toISOString().slice(0, 10)
}

/** Current clock time in Asia/Manila as `HH:mm`. */
export function nowTimeInManila(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${hh}:${mm}`
}

/**
 * SQL expression: current timestamp as Asia/Manila wall clock (UTC+8, no DST).
 * Stored in DATETIME columns so DB tools show Philippine time.
 */
export const MANILA_NOW_SQL = `DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR)`

/**
 * Serialize a MySQL DATETIME that stores Asia/Manila wall clock to ISO-8601 with +08:00.
 * mysql2 returns DATETIME as a JS Date using the process local zone for the wall-clock fields;
 * we rebuild from those getters so the offset is explicit for the frontend.
 */
export function manilaDateTimeToIso(
  value: Date | string | null | undefined,
): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const m =
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/.exec(
        value.trim(),
      )
    if (!m) return null
    const ms = (m[7] ?? '0').padEnd(3, '0')
    const sec = m[6] ?? '00'
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${sec}.${ms}+08:00`
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const y = value.getFullYear()
  const mo = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  const h = String(value.getHours()).padStart(2, '0')
  const mi = String(value.getMinutes()).padStart(2, '0')
  const s = String(value.getSeconds()).padStart(2, '0')
  const ms = String(value.getMilliseconds()).padStart(3, '0')
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}+08:00`
}
