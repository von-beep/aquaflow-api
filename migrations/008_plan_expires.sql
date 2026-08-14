-- Plan expiry for manual activate / renewal

ALTER TABLE stations
  ADD COLUMN plan_expires_at DATE NULL AFTER billing_interval;
