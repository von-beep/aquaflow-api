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
