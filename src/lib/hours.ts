/** Normalize MySQL TIME / string to `HH:mm`, or null. */
export function parseHm(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(value.trim())
    if (!m) return null
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // mysql2 maps TIME to Date using UTC clock fields
    const hour = value.getUTCHours()
    const minute = value.getUTCMinutes()
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  return null
}

/** Persist API `HH:mm` as MySQL TIME string, or null. */
export function toMysqlTime(hm: string | null): string | null {
  if (!hm) return null
  const parsed = parseHm(hm)
  return parsed ? `${parsed}:00` : null
}
