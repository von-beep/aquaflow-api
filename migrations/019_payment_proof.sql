-- Screenshot proof of online GCash/Maya payment (path under uploads/).
ALTER TABLE deliveries
  ADD COLUMN payment_proof_path VARCHAR(255) NULL DEFAULT NULL AFTER note;
