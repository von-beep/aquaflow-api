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
