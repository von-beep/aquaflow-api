-- Flexible per-station payment platforms (GCash, Maya, BPI, custom…) + QR path.
-- Consumer checkout only offers methods that have a QR uploaded (plus Cash).

ALTER TABLE deliveries
  MODIFY COLUMN pay_mode VARCHAR(32) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS station_payment_methods (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  station_id VARCHAR(64) NOT NULL,
  name VARCHAR(32) NOT NULL,
  slug VARCHAR(32) NOT NULL,
  qr_path VARCHAR(255) NULL DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_spm_station_slug (station_id, slug),
  UNIQUE KEY uq_spm_station_name (station_id, name),
  KEY idx_spm_station (station_id),
  CONSTRAINT fk_spm_station FOREIGN KEY (station_id) REFERENCES stations (id)
    ON DELETE CASCADE
);

-- Seed GCash for every tenant station (carry over existing QR if any).
INSERT INTO station_payment_methods (id, station_id, name, slug, qr_path, sort_order)
SELECT
  CONCAT('pm_gcash_', s.id),
  s.id,
  'GCash',
  'gcash',
  NULLIF(TRIM(COALESCE(st.gcash_qr_path, st.qrph_path)), ''),
  10
FROM stations s
LEFT JOIN settings st ON st.station_id = s.id
WHERE s.id <> 's_platform'
ON DUPLICATE KEY UPDATE
  qr_path = COALESCE(VALUES(qr_path), station_payment_methods.qr_path);

-- Seed Maya for every tenant station.
INSERT INTO station_payment_methods (id, station_id, name, slug, qr_path, sort_order)
SELECT
  CONCAT('pm_maya_', s.id),
  s.id,
  'Maya',
  'maya',
  NULLIF(TRIM(st.maya_qr_path), ''),
  20
FROM stations s
LEFT JOIN settings st ON st.station_id = s.id
WHERE s.id <> 's_platform'
ON DUPLICATE KEY UPDATE
  qr_path = COALESCE(VALUES(qr_path), station_payment_methods.qr_path);
