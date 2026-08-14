import { describe, expect, it } from 'vitest'
import { planStatusAfterUnsuspend } from './planRestore.js'

describe('planStatusAfterUnsuspend', () => {
  it('restores active', () => {
    expect(planStatusAfterUnsuspend('active')).toBe('active')
  })

  it('defaults expired/unknown/suspended previous to trial', () => {
    expect(planStatusAfterUnsuspend('trial')).toBe('trial')
    expect(planStatusAfterUnsuspend('suspended')).toBe('trial')
    expect(planStatusAfterUnsuspend(null)).toBe('trial')
    expect(planStatusAfterUnsuspend(undefined)).toBe('trial')
  })
})
