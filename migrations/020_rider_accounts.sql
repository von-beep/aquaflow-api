-- Rider login accounts: users.role includes rider; link to riders row.
ALTER TABLE users
  MODIFY COLUMN role ENUM('owner', 'staff', 'rider') NOT NULL DEFAULT 'owner';

ALTER TABLE users
  ADD COLUMN rider_id VARCHAR(64) NULL DEFAULT NULL AFTER role;

ALTER TABLE users
  ADD CONSTRAINT fk_users_rider
    FOREIGN KEY (rider_id) REFERENCES riders (id) ON DELETE SET NULL;

ALTER TABLE users
  ADD UNIQUE KEY uq_users_rider_id (rider_id);
