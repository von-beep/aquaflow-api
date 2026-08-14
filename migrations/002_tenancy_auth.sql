-- Phase 7 — Tenancy + Auth
-- Adds stations (tenants), station_id on domain tables, users

CREATE TABLE IF NOT EXISTS stations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  plan_status ENUM('trial', 'active', 'suspended') NOT NULL DEFAULT 'trial',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stations_slug (slug)
);

-- Demo station for backfilling existing Phase 6 seed rows
INSERT INTO stations (id, name, slug, plan_status)
VALUES ('s_demo', 'AquaFlow Purified Water', 'demo', 'trial')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- settings: one row per station (replace singleton)
CREATE TABLE IF NOT EXISTS settings_new (
  station_id VARCHAR(64) NOT NULL PRIMARY KEY,
  station_name VARCHAR(255) NOT NULL DEFAULT '',
  owner VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  currency VARCHAR(8) NOT NULL DEFAULT '₱',
  CONSTRAINT fk_settings_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE
);

INSERT INTO settings_new (station_id, station_name, owner, phone, currency)
SELECT 's_demo', station_name, owner, phone, currency FROM settings;

DROP TABLE settings;
RENAME TABLE settings_new TO settings;

-- inventory: one row per station
CREATE TABLE IF NOT EXISTS inventory_new (
  station_id VARCHAR(64) NOT NULL PRIMARY KEY,
  full_count INT NOT NULL DEFAULT 0,
  empty_count INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_inventory_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE
);

INSERT INTO inventory_new (station_id, full_count, empty_count)
SELECT 's_demo', full_count, empty_count FROM inventory;

DROP TABLE inventory;
RENAME TABLE inventory_new TO inventory;

-- products
ALTER TABLE products ADD COLUMN station_id VARCHAR(64) NULL;
UPDATE products SET station_id = 's_demo' WHERE station_id IS NULL;
ALTER TABLE products MODIFY station_id VARCHAR(64) NOT NULL;
ALTER TABLE products ADD CONSTRAINT fk_products_station FOREIGN KEY (station_id) REFERENCES stations (id);
ALTER TABLE products ADD INDEX idx_products_station (station_id);

-- customers
ALTER TABLE customers ADD COLUMN station_id VARCHAR(64) NULL;
UPDATE customers SET station_id = 's_demo' WHERE station_id IS NULL;
ALTER TABLE customers MODIFY station_id VARCHAR(64) NOT NULL;
ALTER TABLE customers ADD CONSTRAINT fk_customers_station FOREIGN KEY (station_id) REFERENCES stations (id);
ALTER TABLE customers ADD INDEX idx_customers_station (station_id);

-- riders
ALTER TABLE riders ADD COLUMN station_id VARCHAR(64) NULL;
UPDATE riders SET station_id = 's_demo' WHERE station_id IS NULL;
ALTER TABLE riders MODIFY station_id VARCHAR(64) NOT NULL;
ALTER TABLE riders ADD CONSTRAINT fk_riders_station FOREIGN KEY (station_id) REFERENCES stations (id);
ALTER TABLE riders ADD INDEX idx_riders_station (station_id);

-- deliveries
ALTER TABLE deliveries ADD COLUMN station_id VARCHAR(64) NULL;
UPDATE deliveries SET station_id = 's_demo' WHERE station_id IS NULL;
ALTER TABLE deliveries MODIFY station_id VARCHAR(64) NOT NULL;
ALTER TABLE deliveries ADD CONSTRAINT fk_deliveries_station FOREIGN KEY (station_id) REFERENCES stations (id);
ALTER TABLE deliveries ADD INDEX idx_deliveries_station (station_id);

-- utang
ALTER TABLE utang ADD COLUMN station_id VARCHAR(64) NULL;
UPDATE utang SET station_id = 's_demo' WHERE station_id IS NULL;
ALTER TABLE utang MODIFY station_id VARCHAR(64) NOT NULL;
ALTER TABLE utang ADD CONSTRAINT fk_utang_station FOREIGN KEY (station_id) REFERENCES stations (id);
ALTER TABLE utang ADD INDEX idx_utang_station (station_id);

-- payments
ALTER TABLE payments ADD COLUMN station_id VARCHAR(64) NULL;
UPDATE payments SET station_id = 's_demo' WHERE station_id IS NULL;
ALTER TABLE payments MODIFY station_id VARCHAR(64) NOT NULL;
ALTER TABLE payments ADD CONSTRAINT fk_payments_station FOREIGN KEY (station_id) REFERENCES stations (id);
ALTER TABLE payments ADD INDEX idx_payments_station (station_id);

-- users (email unique globally for simple login)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  station_id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('owner', 'staff') NOT NULL DEFAULT 'owner',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT fk_users_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  INDEX idx_users_station (station_id)
);
