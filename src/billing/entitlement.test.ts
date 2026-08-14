import { describe, expect, it } from 'vitest'
import {
  isStationEntitled,
  planOutcomeFromXenditEvent,
} from './entitlement.js'

describe('isStationEntitled', () => {
  const now = new Date('2026-08-04T12:00:00Z')

  it('allows active plans', () => {
    expect(isStationEntitled({ planStatus: 'active', trialEndsAt: null }, now)).toBe(true)
  })

  it('blocks suspended', () => {
    expect(isStationEntitled({ planStatus: 'suspended', trialEndsAt: '2099-01-01' }, now)).toBe(
      false,
    )
  })

  it('allows trial before end date (inclusive)', () => {
    expect(isStationEntitled({ planStatus: 'trial', trialEndsAt: '2026-08-04' }, now)).toBe(true)
    expect(isStationEntitled({ planStatus: 'trial', trialEndsAt: '2026-08-05' }, now)).toBe(true)
  })

  it('blocks expired trial', () => {
    expect(isStationEntitled({ planStatus: 'trial', trialEndsAt: '2026-08-03' }, now)).toBe(false)
  })

  it('allows trial with null end', () => {
    expect(isStationEntitled({ planStatus: 'trial', trialEndsAt: null }, now)).toBe(true)
  })

  it('allows active with null plan expiry', () => {
    expect(
      isStationEntitled({ planStatus: 'active', trialEndsAt: null, planExpiresAt: null }, now),
    ).toBe(true)
  })

  it('allows active until plan expiry inclusive', () => {
    expect(
      isStationEntitled(
        { planStatus: 'active', trialEndsAt: null, planExpiresAt: '2026-08-04' },
        now,
      ),
    ).toBe(true)
  })

  it('blocks active after plan expiry', () => {
    expect(
      isStationEntitled(
        { planStatus: 'active', trialEndsAt: null, planExpiresAt: '2026-08-03' },
        now,
      ),
    ).toBe(false)
  })
})

describe('planOutcomeFromXenditEvent', () => {
  it('activates on plan activated / cycle succeeded', () => {
    expect(planOutcomeFromXenditEvent('recurring.plan.activated')).toBe('activate')
    expect(planOutcomeFromXenditEvent('recurring_plan.activated')).toBe('activate')
    expect(planOutcomeFromXenditEvent('recurring.cycle.succeeded')).toBe('activate')
  })

  it('suspends on inactivated / cycle failed', () => {
    expect(planOutcomeFromXenditEvent('recurring.plan.inactivated')).toBe('suspend')
    expect(planOutcomeFromXenditEvent('recurring.cycle.failed')).toBe('suspend')
  })

  it('ignores unknown events', () => {
    expect(planOutcomeFromXenditEvent('invoice.paid')).toBe('ignore')
  })
})
