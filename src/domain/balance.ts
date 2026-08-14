export function customerBalance(
  customerId: string,
  utang: { customerId: string; amount: number }[],
  payments: { customerId: string; amount: number }[],
): number {
  const owed = utang
    .filter((u) => u.customerId === customerId)
    .reduce((a, b) => a + Number(b.amount), 0)
  const paid = payments
    .filter((p) => p.customerId === customerId)
    .reduce((a, b) => a + Number(b.amount), 0)
  return owed - paid
}

export function isClear(balance: number): boolean {
  return balance <= 0
}
