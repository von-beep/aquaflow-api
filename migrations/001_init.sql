-- AquaFlow domain schema (aligned with Aquaflow frontend src/domain/types.ts)
-- Phase 6 — API foundation

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  station_name VARCHAR(255) NOT NULL DEFAULT '',
  owner VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  currency VARCHAR(8) NOT NULL DEFAULT '₱',
  CONSTRAINT settings_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS inventory (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  full_count INT NOT NULL DEFAULT 0,
  empty_count INT NOT NULL DEFAULT 0,
  CONSTRAINT inventory_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  INDEX idx_products_name (name)
);

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL DEFAULT '',
  addr VARCHAR(512) NOT NULL DEFAULT '',
  gallons_out INT NOT NULL DEFAULT 0,
  note TEXT NOT NULL,
  INDEX idx_customers_name (name)
);

CREATE TABLE IF NOT EXISTS riders (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL DEFAULT '',
  INDEX idx_riders_name (name)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  delivery_date DATE NOT NULL,
  delivery_time VARCHAR(16) NOT NULL DEFAULT '',
  customer_id VARCHAR(64) NOT NULL,
  rider_id VARCHAR(64) NOT NULL,
  prod_id VARCHAR(64) NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  amount DECIMAL(12, 2) NOT NULL,
  status ENUM('Pending', 'In Progress', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Pending',
  paid TINYINT(1) NOT NULL DEFAULT 0,
  pay_mode VARCHAR(16) NOT NULL DEFAULT '',
  note TEXT NOT NULL,
  CONSTRAINT fk_deliveries_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_deliveries_rider FOREIGN KEY (rider_id) REFERENCES riders (id),
  CONSTRAINT fk_deliveries_product FOREIGN KEY (prod_id) REFERENCES products (id),
  INDEX idx_deliveries_date (delivery_date),
  INDEX idx_deliveries_status (status),
  INDEX idx_deliveries_customer (customer_id),
  INDEX idx_deliveries_rider (rider_id)
);

CREATE TABLE IF NOT EXISTS utang (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  ts DATE NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  note TEXT NOT NULL,
  delivery_id VARCHAR(64) NULL,
  CONSTRAINT fk_utang_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_utang_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON DELETE SET NULL,
  INDEX idx_utang_customer (customer_id),
  INDEX idx_utang_ts (ts)
);

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  ts DATE NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  note TEXT NOT NULL,
  mode ENUM('Cash', 'GCash') NOT NULL,
  CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  INDEX idx_payments_customer (customer_id),
  INDEX idx_payments_ts (ts)
);
