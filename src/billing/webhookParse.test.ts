import { describe, expect, it } from 'vitest'
import { parseXenditWebhook } from '../routes/xenditWebhook.js'

describe('parseXenditWebhook', () => {
  it('reads nested data + metadata', () => {
    const parsed = parseXenditWebhook({
      event: 'recurring.plan.activated',
      data: {
        id: 'plan_abc',
        reference_id: 's_demo:xyz',
        metadata: { station_id: 's_demo' },
      },
    })
    expect(parsed.event).toBe('recurring.plan.activated')
    expect(parsed.planId).toBe('plan_abc')
    expect(parsed.referenceId).toBe('s_demo:xyz')
    expect(parsed.stationIdMeta).toBe('s_demo')
  })
})
