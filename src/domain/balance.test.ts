import { describe, expect, it } from 'vitest'
import { customerBalance, isClear } from '../domain/balance.js'

describe('customerBalance', () => {
  it('is sum(utang) − sum(payments)', () => {
    const utang = [
      { customerId: 'c1', amount: 100 },
      { customerId: 'c1', amount: 50 },
    ]
    const payments = [{ customerId: 'c1', amount: 40 }]
    expect(customerBalance('c1', utang, payments)).toBe(110)
  })

  it('ignores other customers', () => {
    expect(
      customerBalance('c1', [{ customerId: 'c2', amount: 999 }], []),
    ).toBe(0)
  })

  it('CLEAR when balance <= 0', () => {
    expect(isClear(0)).toBe(true)
    expect(isClear(-1)).toBe(true)
    expect(isClear(1)).toBe(false)
  })
})
