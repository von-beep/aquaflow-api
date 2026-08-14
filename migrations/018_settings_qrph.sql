-- Station QR Ph (InstaPay / PESONet QR) image path for GCash checkout display.
ALTER TABLE settings
  ADD COLUMN qrph_path VARCHAR(255) NULL DEFAULT NULL AFTER currency;
