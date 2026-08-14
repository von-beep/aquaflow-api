-- Phase 11 — SaaS onboarding: trial window, station profile, invites

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
