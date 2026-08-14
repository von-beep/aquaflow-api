export type BillingInterval = 'monthly' | 'yearly'

export type ExpiryMode = 'auto' | 'manual'

export function parseBillingInterval(value: unknown): BillingInterval | null {
  if (value === 'monthly' || value === 'yearly') return value
  return null
}

export function parseExpiryMode(value: unknown): ExpiryMode | null {
  if (value === 'auto' || value === 'manual') return value
  return null
}

/** YYYY-MM-DD only. */
export function parsePlanExpiryDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null
  }
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Add one month or one year to a UTC date-only, return YYYY-MM-DD. */
export function autoPlanExpiresAt(
  interval: BillingInterval,
  from: Date = new Date(),
): string {
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  const d = from.getUTCDate()
  const base = new Date(Date.UTC(y, m, d))
  if (interval === 'monthly') {
    base.setUTCMonth(base.getUTCMonth() + 1)
  } else {
    base.setUTCFullYear(base.getUTCFullYear() + 1)
  }
  return base.toISOString().slice(0, 10)
}

/**
 * Resolve expiry from request body.
 * - auto: today + 1 month/year
 * - manual: require valid planExpiresAt
 * Default mode is auto when omitted (back-compat).
 */
export function resolvePlanExpiresAt(input: {
  billingInterval: BillingInterval
  expiryMode?: unknown
  planExpiresAt?: unknown
  now?: Date
}): { expiresAt: string } | { error: string } {
  const mode = parseExpiryMode(input.expiryMode) ?? 'auto'
  if (mode === 'auto') {
    return { expiresAt: autoPlanExpiresAt(input.billingInterval, input.now ?? new Date()) }
  }
  const manual = parsePlanExpiryDate(input.planExpiresAt)
  if (!manual) {
    return { error: 'planExpiresAt must be a valid YYYY-MM-DD date when expiryMode is manual' }
  }
  return { expiresAt: manual }
}
