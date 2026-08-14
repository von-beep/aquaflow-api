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
