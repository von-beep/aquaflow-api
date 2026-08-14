-- Phase 12 — Xendit subscriptions / billing columns on stations

ALTER TABLE stations
  ADD COLUMN plan_code VARCHAR(64) NULL AFTER plan_status,
  ADD COLUMN xendit_customer_ref VARCHAR(128) NULL AFTER trial_ends_at,
  ADD COLUMN xendit_plan_id VARCHAR(128) NULL AFTER xendit_customer_ref,
  ADD COLUMN xendit_session_id VARCHAR(128) NULL AFTER xendit_plan_id,
  ADD COLUMN xendit_checkout_ref VARCHAR(128) NULL AFTER xendit_session_id;

ALTER TABLE stations
  ADD INDEX idx_stations_xendit_plan (xendit_plan_id),
  ADD INDEX idx_stations_xendit_checkout_ref (xendit_checkout_ref);
