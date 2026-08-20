-- Station operating hours (Asia/Manila). NULL = not configured.
ALTER TABLE settings
  ADD COLUMN open_time TIME NULL DEFAULT NULL AFTER currency,
  ADD COLUMN close_time TIME NULL DEFAULT NULL AFTER open_time;

-- Sensible default for existing stations (8:00 AM – 6:00 PM).
UPDATE settings
SET open_time = '08:00:00',
    close_time = '18:00:00'
WHERE open_time IS NULL AND close_time IS NULL;
