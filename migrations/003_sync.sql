-- Phase 9 — Sync: updated_at + soft-delete tombstones on domain tables

ALTER TABLE products
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL,
  ADD INDEX idx_products_sync (station_id, updated_at),
  ADD INDEX idx_products_deleted (station_id, deleted_at);

ALTER TABLE customers
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL,
  ADD INDEX idx_customers_sync (station_id, updated_at),
  ADD INDEX idx_customers_deleted (station_id, deleted_at);

ALTER TABLE riders
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL,
  ADD INDEX idx_riders_sync (station_id, updated_at),
  ADD INDEX idx_riders_deleted (station_id, deleted_at);

ALTER TABLE deliveries
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL,
  ADD INDEX idx_deliveries_sync (station_id, updated_at),
  ADD INDEX idx_deliveries_deleted (station_id, deleted_at);

ALTER TABLE utang
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL,
  ADD INDEX idx_utang_sync (station_id, updated_at),
  ADD INDEX idx_utang_deleted (station_id, deleted_at);

ALTER TABLE payments
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL,
  ADD INDEX idx_payments_sync (station_id, updated_at),
  ADD INDEX idx_payments_deleted (station_id, deleted_at);

ALTER TABLE settings
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD INDEX idx_settings_sync (station_id, updated_at);

ALTER TABLE inventory
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD INDEX idx_inventory_sync (station_id, updated_at);
