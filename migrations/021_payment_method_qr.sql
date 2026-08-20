-- Per-method payment QR (GCash / Maya). Replaces shared QR Ph as primary.
ALTER TABLE settings
  ADD COLUMN gcash_qr_path VARCHAR(255) NULL DEFAULT NULL AFTER qrph_path,
  ADD COLUMN maya_qr_path VARCHAR(255) NULL DEFAULT NULL AFTER gcash_qr_path;

-- Existing QR Ph → GCash (stations can replace Maya separately).
UPDATE settings
SET gcash_qr_path = qrph_path
WHERE qrph_path IS NOT NULL
  AND (gcash_qr_path IS NULL OR gcash_qr_path = '');
