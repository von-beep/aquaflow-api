-- Checkout / multi-item order grouping for deliveries.
ALTER TABLE deliveries
  ADD COLUMN order_id VARCHAR(64) NULL AFTER id;

UPDATE deliveries SET order_id = id WHERE order_id IS NULL;

ALTER TABLE deliveries
  MODIFY order_id VARCHAR(64) NOT NULL;

ALTER TABLE deliveries
  ADD INDEX idx_deliveries_order (station_id, order_id);
