import { describe, expect, it } from 'vitest'
import {
  autoPlanExpiresAt,
  parseBillingInterval,
  parseExpiryMode,
  parsePlanExpiryDate,
  resolvePlanExpiresAt,
} from './billingInterval.js'

describe('parseBillingInterval', () => {
  it('accepts monthly and yearly', () => {
    expect(parseBillingInterval('monthly')).toBe('monthly')
    expect(parseBillingInterval('yearly')).toBe('yearly')
  })

  it('rejects other values', () => {
    expect(parseBillingInterval('week')).toBeNull()
    expect(parseBillingInterval(null)).toBeNull()
  })
})

describe('autoPlanExpiresAt', () => {
  it('adds one month', () => {
    expect(autoPlanExpiresAt('monthly', new Date('2026-08-04T12:00:00Z'))).toBe('2026-09-04')
  })

  it('adds one year', () => {
    expect(autoPlanExpiresAt('yearly', new Date('2026-08-04T12:00:00Z'))).toBe('2027-08-04')
  })
})

describe('resolvePlanExpiresAt', () => {
  it('defaults to auto', () => {
    const r = resolvePlanExpiresAt({
      billingInterval: 'monthly',
      now: new Date('2026-01-15T00:00:00Z'),
    })
    expect(r).toEqual({ expiresAt: '2026-02-15' })
  })

  it('uses manual date', () => {
    expect(
      resolvePlanExpiresAt({
        billingInterval: 'yearly',
        expiryMode: 'manual',
        planExpiresAt: '2027-12-31',
      }),
    ).toEqual({ expiresAt: '2027-12-31' })
  })

  it('rejects bad manual date', () => {
    expect(
      resolvePlanExpiresAt({
        billingInterval: 'monthly',
        expiryMode: 'manual',
        planExpiresAt: 'not-a-date',
      }),
    ).toEqual({
      error: 'planExpiresAt must be a valid YYYY-MM-DD date when expiryMode is manual',
    })
  })
})

describe('parseExpiryMode / parsePlanExpiryDate', () => {
  it('parses modes', () => {
    expect(parseExpiryMode('auto')).toBe('auto')
    expect(parseExpiryMode('manual')).toBe('manual')
    expect(parseExpiryMode('x')).toBeNull()
  })

  it('rejects invalid calendar dates', () => {
    expect(parsePlanExpiryDate('2026-02-30')).toBeNull()
    expect(parsePlanExpiryDate('2026-01-15')).toBe('2026-01-15')
  })
})
