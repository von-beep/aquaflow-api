import { describe, expect, it } from 'vitest'
import {
  manilaDateTimeToIso,
  nowTimeInManila,
  todayInManila,
  toDateOnlyString,
} from './dates.js'

describe('toDateOnlyString', () => {
  it('returns null for empty values', () => {
    expect(toDateOnlyString(null)).toBeNull()
    expect(toDateOnlyString(undefined)).toBeNull()
    expect(toDateOnlyString('')).toBeNull()
  })

  it('keeps ISO date strings', () => {
    expect(toDateOnlyString('2026-09-04')).toBe('2026-09-04')
    expect(toDateOnlyString('2026-09-04T00:00:00.000Z')).toBe('2026-09-04')
  })

  it('formats Date at local midnight without locale text', () => {
    const d = new Date(2026, 8, 4) // Sep 4 local
    expect(toDateOnlyString(d)).toBe('2026-09-04')
    expect(String(d).slice(0, 10)).not.toBe('2026-09-04')
  })

  it('rejects non-ISO strings', () => {
    expect(toDateOnlyString('Fri Sep 04')).toBeNull()
  })

  it('does not shift DATE via toISOString in UTC+8', () => {
    // Local midnight Aug 10 in +08 → ISO is still Aug 9 UTC
    const localMidnight = new Date(2026, 7, 10, 0, 0, 0, 0)
    expect(localMidnight.toISOString().slice(0, 10)).toBe('2026-08-09')
    expect(toDateOnlyString(localMidnight)).toBe('2026-08-10')
  })

  it('todayInManila / nowTimeInManila use Asia/Manila', () => {
    // 2026-08-09 20:00 UTC = Aug 10 04:00 in Manila
    const utcEvening = new Date('2026-08-09T20:00:00.000Z')
    expect(todayInManila(utcEvening)).toBe('2026-08-10')
    expect(nowTimeInManila(utcEvening)).toBe('04:00')
  })

  it('manilaDateTimeToIso keeps wall clock with +08:00', () => {
    expect(manilaDateTimeToIso('2026-08-10 12:30:00')).toBe(
      '2026-08-10T12:30:00.000+08:00',
    )
    const wall = new Date(2026, 7, 10, 12, 30, 0, 0)
    expect(manilaDateTimeToIso(wall)).toBe('2026-08-10T12:30:00.000+08:00')
  })

  it('unblocks active stations that mysql2 returns as Date', async () => {
    const { isStationEntitled } = await import('../billing/entitlement.js')
    const planExpiresAt = toDateOnlyString(new Date(2026, 8, 4))
    expect(planExpiresAt).toBe('2026-09-04')
    expect(
      isStationEntitled(
        { planStatus: 'active', trialEndsAt: null, planExpiresAt },
        new Date('2026-08-05T12:00:00Z'),
      ),
    ).toBe(true)
    expect(
      isStationEntitled(
        {
          planStatus: 'active',
          trialEndsAt: null,
          planExpiresAt: String(new Date(2026, 8, 4)).slice(0, 10),
        },
        new Date('2026-08-05T12:00:00Z'),
      ),
    ).toBe(false)
  })
})
