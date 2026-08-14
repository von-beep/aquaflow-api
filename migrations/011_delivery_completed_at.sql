-- Timestamp when a delivery is finished (Finish Transaction).
ALTER TABLE deliveries
  ADD COLUMN completed_at DATETIME(3) NULL DEFAULT NULL AFTER note;

-- Best-effort backfill for already-completed rows.
UPDATE deliveries
SET completed_at = updated_at
WHERE status = 'Completed' AND completed_at IS NULL;
