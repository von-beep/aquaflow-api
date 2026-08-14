/** Pure entitlement rules for cloud sync (Phase 12). */

export type StationPlanFields = {
  planStatus: string
  trialEndsAt: string | null
  /** When set on active plans, sync is blocked after this date (inclusive until end of day). */
  planExpiresAt?: string | null
}

/**
 * Cloud sync is allowed when:
 * - plan_status is `active` and plan_expires_at is null or today-or-later, or
 * - plan_status is `trial` and trial_ends_at is null or today-or-later (DATE, inclusive).
 * Suspended / expired / unknown → not entitled.
 */
export function isStationEntitled(
  station: StationPlanFields,
  now: Date = new Date(),
): boolean {
  const status = station.planStatus
  if (status === 'suspended') return false
  if (status === 'active') {
    if (!station.planExpiresAt) return true
    const end = parseDateOnly(station.planExpiresAt)
    if (!end) return false
    return end.getTime() >= dateOnly(now).getTime()
  }
  if (status === 'trial') {
    if (!station.trialEndsAt) return true
    const end = parseDateOnly(station.trialEndsAt)
    if (!end) return false
    const today = dateOnly(now)
    return end.getTime() >= today.getTime()
  }
  return false
}

export function parseDateOnly(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Map Xendit webhook event names → plan outcome. */
export type PlanWebhookOutcome = 'activate' | 'suspend' | 'ignore'

export function planOutcomeFromXenditEvent(event: string): PlanWebhookOutcome {
  const e = event.toLowerCase().replace(/_/g, '.')
  if (
    e === 'recurring.plan.activated' ||
    e === 'recurring.cycle.succeeded' ||
    e === 'payment.session.completed' ||
    e === 'payment_session.completed'
  ) {
    return 'activate'
  }
  if (e === 'recurring.plan.inactivated' || e === 'recurring.cycle.failed') {
    return 'suspend'
  }
  return 'ignore'
}
