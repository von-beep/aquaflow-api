-- Allow unassigned rider for public / online orders

ALTER TABLE deliveries DROP FOREIGN KEY fk_deliveries_rider;

ALTER TABLE deliveries
  MODIFY rider_id VARCHAR(64) NULL;

ALTER TABLE deliveries
  ADD CONSTRAINT fk_deliveries_rider
  FOREIGN KEY (rider_id) REFERENCES riders (id)
  ON DELETE SET NULL;
