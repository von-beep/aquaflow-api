-- Station address + map pin (OpenStreetMap / Leaflet)

ALTER TABLE stations
  ADD COLUMN address VARCHAR(512) NOT NULL DEFAULT '' AFTER phone,
  ADD COLUMN lat DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN lng DECIMAL(10, 7) NULL AFTER lat;

ALTER TABLE settings
  ADD COLUMN address VARCHAR(512) NOT NULL DEFAULT '' AFTER phone,
  ADD COLUMN lat DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN lng DECIMAL(10, 7) NULL AFTER lat;
