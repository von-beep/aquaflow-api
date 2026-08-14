-- Phase 13+ — Manual activate: billing interval on stations

ALTER TABLE stations
  ADD COLUMN billing_interval ENUM('monthly', 'yearly') NULL
    AFTER plan_code;
