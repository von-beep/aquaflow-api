-- Phase 13 — Platform ops: super-admin flag + suspend restore

ALTER TABLE users
  ADD COLUMN is_platform_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER role;

ALTER TABLE stations
  ADD COLUMN previous_plan_status ENUM('trial', 'active', 'suspended') NULL
    AFTER plan_status;

-- Internal station for platform operators (never suspend via admin API)
INSERT INTO stations (id, name, slug, plan_status, phone, trial_ends_at)
VALUES ('s_platform', 'AquaFlow Platform', 'platform', 'active', '', NULL)
ON DUPLICATE KEY UPDATE name = VALUES(name), plan_status = 'active';

INSERT INTO settings (station_id, station_name, owner, phone, currency)
VALUES ('s_platform', 'AquaFlow Platform', '', '', '₱')
ON DUPLICATE KEY UPDATE station_name = VALUES(station_name);

INSERT INTO inventory (station_id, full_count, empty_count)
VALUES ('s_platform', 0, 0)
ON DUPLICATE KEY UPDATE full_count = full_count;
