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
