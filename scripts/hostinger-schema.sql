-- Aquaflow-api schema for Hostinger phpMyAdmin import
-- Select database: aquaflow, then Import this file
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

-- ===== 001_init.sql =====
-- AquaFlow domain schema (aligned with Aquaflow frontend src/domain/types.ts)
-- Phase 6 â€” API foundation

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  station_name VARCHAR(255) NOT NULL DEFAULT '',
  owner VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  currency VARCHAR(8) NOT NULL DEFAULT 'â‚±',
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


-- ===== 002_tenancy_auth.sql =====
-- Phase 7 â€” Tenancy + Auth
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
  currency VARCHAR(8) NOT NULL DEFAULT 'â‚±',
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


-- ===== 003_sync.sql =====
-- Phase 9 â€” Sync: updated_at + soft-delete tombstones on domain tables

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


-- ===== 004_onboarding.sql =====
-- Phase 11 â€” SaaS onboarding: trial window, station profile, invites

ALTER TABLE stations
  ADD COLUMN phone VARCHAR(64) NOT NULL DEFAULT '' AFTER name,
  ADD COLUMN trial_ends_at DATE NULL AFTER plan_status;

UPDATE stations
SET trial_ends_at = DATE_ADD(DATE(created_at), INTERVAL 14 DAY)
WHERE trial_ends_at IS NULL AND plan_status = 'trial';

CREATE TABLE IF NOT EXISTS invites (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  station_id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NULL,
  token VARCHAR(64) NOT NULL,
  role ENUM('staff') NOT NULL DEFAULT 'staff',
  created_by VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  accepted_user_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invites_token (token),
  CONSTRAINT fk_invites_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_invites_creator FOREIGN KEY (created_by) REFERENCES users (id),
  INDEX idx_invites_station (station_id)
);


-- ===== 005_billing.sql =====
-- Phase 12 â€” Xendit subscriptions / billing columns on stations

ALTER TABLE stations
  ADD COLUMN plan_code VARCHAR(64) NULL AFTER plan_status,
  ADD COLUMN xendit_customer_ref VARCHAR(128) NULL AFTER trial_ends_at,
  ADD COLUMN xendit_plan_id VARCHAR(128) NULL AFTER xendit_customer_ref,
  ADD COLUMN xendit_session_id VARCHAR(128) NULL AFTER xendit_plan_id,
  ADD COLUMN xendit_checkout_ref VARCHAR(128) NULL AFTER xendit_session_id;

ALTER TABLE stations
  ADD INDEX idx_stations_xendit_plan (xendit_plan_id),
  ADD INDEX idx_stations_xendit_checkout_ref (xendit_checkout_ref);


-- ===== 006_platform_ops.sql =====
-- Phase 13 â€” Platform ops: super-admin flag + suspend restore

ALTER TABLE users
  ADD COLUMN is_platform_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER role;

ALTER TABLE stations
  ADD COLUMN previous_plan_status ENUM('trial', 'active', 'suspended') NULL
    AFTER plan_status;

-- Internal station for platform operators (never suspend via admin API)
INSERT INTO stations (id, name, slug, plan_status, phone, trial_ends_at)
VALUES ('s_platform', 'AquaFlow Platform', 'platform', 'active', '', NULL)
ON DUPLICATE KEY UPDATE name = VALUES(name), plan_status = 'active';

INSERT INTO settings (station_id, station_name, owner, phone, currency)
VALUES ('s_platform', 'AquaFlow Platform', '', '', 'â‚±')
ON DUPLICATE KEY UPDATE station_name = VALUES(station_name);

INSERT INTO inventory (station_id, full_count, empty_count)
VALUES ('s_platform', 0, 0)
ON DUPLICATE KEY UPDATE full_count = full_count;


-- ===== 007_billing_interval.sql =====
-- Phase 13+ â€” Manual activate: billing interval on stations

ALTER TABLE stations
  ADD COLUMN billing_interval ENUM('monthly', 'yearly') NULL
    AFTER plan_code;


-- ===== 008_plan_expires.sql =====
-- Plan expiry for manual activate / renewal

ALTER TABLE stations
  ADD COLUMN plan_expires_at DATE NULL AFTER billing_interval;


-- ===== 009_station_address.sql =====
-- Station address + map pin (OpenStreetMap / Leaflet)

ALTER TABLE stations
  ADD COLUMN address VARCHAR(512) NOT NULL DEFAULT '' AFTER phone,
  ADD COLUMN lat DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN lng DECIMAL(10, 7) NULL AFTER lat;

ALTER TABLE settings
  ADD COLUMN address VARCHAR(512) NOT NULL DEFAULT '' AFTER phone,
  ADD COLUMN lat DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN lng DECIMAL(10, 7) NULL AFTER lat;


-- ===== 010_delivery_rider_nullable.sql =====
-- Allow unassigned rider for public / online orders

ALTER TABLE deliveries DROP FOREIGN KEY fk_deliveries_rider;

ALTER TABLE deliveries
  MODIFY rider_id VARCHAR(64) NULL;

ALTER TABLE deliveries
  ADD CONSTRAINT fk_deliveries_rider
  FOREIGN KEY (rider_id) REFERENCES riders (id)
  ON DELETE SET NULL;


-- ===== 011_delivery_completed_at.sql =====
-- Timestamp when a delivery is finished (Finish Transaction).
ALTER TABLE deliveries
  ADD COLUMN completed_at DATETIME(3) NULL DEFAULT NULL AFTER note;

-- Best-effort backfill for already-completed rows.
UPDATE deliveries
SET completed_at = updated_at
WHERE status = 'Completed' AND completed_at IS NULL;


-- ===== 012_completed_at_manila.sql =====
-- completed_at was written with UTC_TIMESTAMP; shift existing rows to Asia/Manila (UTC+8).
-- New writes use DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR).
UPDATE deliveries
SET completed_at = DATE_ADD(completed_at, INTERVAL 8 HOUR)
WHERE completed_at IS NOT NULL;


-- ===== 013_consumer_users.sql =====
-- Marketplace shopper accounts (shared across stations).
CREATE TABLE IF NOT EXISTS consumer_users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_consumer_users_email (email)
);

ALTER TABLE deliveries
  ADD COLUMN consumer_user_id VARCHAR(64) NULL DEFAULT NULL AFTER customer_id,
  ADD INDEX idx_deliveries_consumer (consumer_user_id),
  ADD CONSTRAINT fk_deliveries_consumer
    FOREIGN KEY (consumer_user_id) REFERENCES consumer_users (id)
    ON DELETE SET NULL;


-- ===== 014_consumer_addresses.sql =====
-- Saved delivery addresses for marketplace shoppers.
CREATE TABLE IF NOT EXISTS consumer_addresses (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  consumer_user_id VARCHAR(64) NOT NULL,
  label VARCHAR(64) NOT NULL DEFAULT 'Home',
  address VARCHAR(512) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_consumer_addresses_user
    FOREIGN KEY (consumer_user_id) REFERENCES consumer_users (id)
    ON DELETE CASCADE,
  INDEX idx_consumer_addresses_user (consumer_user_id)
);


-- ===== 015_delivery_order_id.sql =====
-- Checkout / multi-item order grouping for deliveries.
ALTER TABLE deliveries
  ADD COLUMN order_id VARCHAR(64) NULL AFTER id;

UPDATE deliveries SET order_id = id WHERE order_id IS NULL;

ALTER TABLE deliveries
  MODIFY order_id VARCHAR(64) NOT NULL;

ALTER TABLE deliveries
  ADD INDEX idx_deliveries_order (station_id, order_id);


-- ===== 016_chat.sql =====
-- Order-scoped chat between marketplace consumers and station staff.
-- Conversations older than 30 days (by last_message_at) are purged by the API.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  station_id VARCHAR(64) NOT NULL,
  consumer_user_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  last_message_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_message_preview VARCHAR(255) NOT NULL DEFAULT '',
  consumer_last_read_at DATETIME(3) NULL,
  station_last_read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_chat_conv_station
    FOREIGN KEY (station_id) REFERENCES stations (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_chat_conv_consumer
    FOREIGN KEY (consumer_user_id) REFERENCES consumer_users (id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_chat_conv_station_order_consumer (station_id, order_id, consumer_user_id),
  INDEX idx_chat_conv_station_last (station_id, last_message_at),
  INDEX idx_chat_conv_consumer_last (consumer_user_id, last_message_at),
  INDEX idx_chat_conv_last_message (last_message_at)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL,
  sender_type ENUM('consumer', 'station') NOT NULL,
  sender_id VARCHAR(64) NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_chat_messages_conv
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id)
    ON DELETE CASCADE,
  INDEX idx_chat_messages_conv_created (conversation_id, created_at)
);


-- ===== 017_chat_station_scoped.sql =====
-- One conversation per station + consumer (not per order/product).
-- Merge any order-scoped duplicates first, then enforce uniqueness.

CREATE TEMPORARY TABLE IF NOT EXISTS chat_conv_keep AS
SELECT
  station_id,
  consumer_user_id,
  SUBSTRING_INDEX(
    GROUP_CONCAT(id ORDER BY last_message_at DESC, created_at DESC SEPARATOR ','),
    ',',
    1
  ) AS keep_id
FROM chat_conversations
GROUP BY station_id, consumer_user_id
HAVING COUNT(*) > 1;

UPDATE chat_messages m
INNER JOIN chat_conversations c ON c.id = m.conversation_id
INNER JOIN chat_conv_keep k
  ON k.station_id = c.station_id AND k.consumer_user_id = c.consumer_user_id
SET m.conversation_id = k.keep_id
WHERE c.id <> k.keep_id;

DELETE c
FROM chat_conversations c
INNER JOIN chat_conv_keep k
  ON k.station_id = c.station_id AND k.consumer_user_id = c.consumer_user_id
WHERE c.id <> k.keep_id;

DROP TEMPORARY TABLE IF EXISTS chat_conv_keep;

ALTER TABLE chat_conversations
  DROP INDEX uq_chat_conv_station_order_consumer;

ALTER TABLE chat_conversations
  MODIFY order_id VARCHAR(64) NULL DEFAULT NULL;

ALTER TABLE chat_conversations
  ADD UNIQUE KEY uq_chat_conv_station_consumer (station_id, consumer_user_id);


-- ===== 018_settings_qrph.sql =====
-- Station QR Ph (InstaPay / PESONet QR) image path for GCash checkout display.
ALTER TABLE settings
  ADD COLUMN qrph_path VARCHAR(255) NULL DEFAULT NULL AFTER currency;


-- ===== 019_payment_proof.sql =====
-- Screenshot proof of online GCash/Maya payment (path under uploads/).
ALTER TABLE deliveries
  ADD COLUMN payment_proof_path VARCHAR(255) NULL DEFAULT NULL AFTER note;


-- ===== 020_rider_accounts.sql =====
-- Rider login accounts: users.role includes rider; link to riders row.
ALTER TABLE users
  MODIFY COLUMN role ENUM('owner', 'staff', 'rider') NOT NULL DEFAULT 'owner';

ALTER TABLE users
  ADD COLUMN rider_id VARCHAR(64) NULL DEFAULT NULL AFTER role;

ALTER TABLE users
  ADD CONSTRAINT fk_users_rider
    FOREIGN KEY (rider_id) REFERENCES riders (id) ON DELETE SET NULL;

ALTER TABLE users
  ADD UNIQUE KEY uq_users_rider_id (rider_id);


SET FOREIGN_KEY_CHECKS=1;

-- Record applied migrations (so npm run migrate won't re-run them)
INSERT IGNORE INTO schema_migrations (id) VALUES ('001_init.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('002_tenancy_auth.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('003_sync.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('004_onboarding.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('005_billing.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('006_platform_ops.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('007_billing_interval.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('008_plan_expires.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('009_station_address.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('010_delivery_rider_nullable.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('011_delivery_completed_at.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('012_completed_at_manila.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('013_consumer_users.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('014_consumer_addresses.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('015_delivery_order_id.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('016_chat.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('017_chat_station_scoped.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('018_settings_qrph.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('019_payment_proof.sql');
INSERT IGNORE INTO schema_migrations (id) VALUES ('020_rider_accounts.sql');
