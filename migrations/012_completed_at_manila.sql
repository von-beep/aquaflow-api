-- completed_at was written with UTC_TIMESTAMP; shift existing rows to Asia/Manila (UTC+8).
-- New writes use DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR).
UPDATE deliveries
SET completed_at = DATE_ADD(completed_at, INTERVAL 8 HOUR)
WHERE completed_at IS NOT NULL;
