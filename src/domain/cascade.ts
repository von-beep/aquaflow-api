import type { PoolConnection } from 'mysql2/promise'

/** Soft-delete a customer and related rows within one station (tombstones for sync). */
export async function deleteCustomerCascade(
  conn: PoolConnection,
  stationId: string,
  customerId: string,
): Promise<boolean> {
  const [custRows] = await conn.query(
    'SELECT id FROM customers WHERE id = ? AND station_id = ? AND deleted_at IS NULL LIMIT 1',
    [customerId, stationId],
  )
  if (!(custRows as { id: string }[]).length) return false

  const [delRows] = await conn.query(
    'SELECT id FROM deliveries WHERE customer_id = ? AND station_id = ? AND deleted_at IS NULL',
    [customerId, stationId],
  )
  const deliveryIds = (delRows as { id: string }[]).map((d) => d.id)

  if (deliveryIds.length) {
    await conn.query(
      `UPDATE utang
       SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
       WHERE station_id = ?
         AND deleted_at IS NULL
         AND (customer_id = ? OR delivery_id IN (${deliveryIds.map(() => '?').join(',')}))`,
      [stationId, customerId, ...deliveryIds],
    )
  } else {
    await conn.query(
      `UPDATE utang
       SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
       WHERE station_id = ? AND customer_id = ? AND deleted_at IS NULL`,
      [stationId, customerId],
    )
  }

  await conn.query(
    `UPDATE payments
     SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
     WHERE station_id = ? AND customer_id = ? AND deleted_at IS NULL`,
    [stationId, customerId],
  )
  await conn.query(
    `UPDATE deliveries
     SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
     WHERE station_id = ? AND customer_id = ? AND deleted_at IS NULL`,
    [stationId, customerId],
  )
  await conn.query(
    `UPDATE customers
     SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
     WHERE station_id = ? AND id = ? AND deleted_at IS NULL`,
    [stationId, customerId],
  )
  return true
}
