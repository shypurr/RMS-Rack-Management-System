-- Rack Management System — schema (MySQL / InnoDB)
-- Applied by seed.js. Safe to re-run: drops and recreates.
--
-- WARNING: this file DROPS item_location and audit_log. Once real organizations
-- own rows in them, `npm run seed` destroys customer data. See the warning in
-- README.md under "Run" before running the seed against anything real.
--
-- ORDERING: every table here has a foreign key to `organization`, which lives in
-- auth.sql. seed.js therefore applies the standing migrations FIRST — without
-- that, these CREATE statements fail with errno 150.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS item_location;
DROP TABLE IF EXISTS source_transaction;
DROP TABLE IF EXISTS rack_master;
SET FOREIGN_KEY_CHECKS = 1;

-- One row per BIN. `id` is the identity and never changes; the human-readable
-- code (R001-S01-B01) is derived from the three integers at read time by
-- src/lib/rackCode.js, so an org growing past a digit boundary re-pads its
-- labels without renaming anything.
CREATE TABLE rack_master (
  id        BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fk_org_id INT NOT NULL,
  rack_no   INT NOT NULL,
  shelf_no  INT NOT NULL,
  bin_no    INT NOT NULL,
  capacity  INT NOT NULL,
  used      INT NOT NULL DEFAULT 0,
  status    ENUM('Vacant','Occupied') NOT NULL DEFAULT 'Vacant',
  CONSTRAINT chk_used_nonneg CHECK (used >= 0),
  CONSTRAINT chk_used_capacity CHECK (used <= capacity),
  CONSTRAINT fk_rack_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rack_bin (fk_org_id, rack_no, shelf_no, bin_no)
) ENGINE=InnoDB;

-- Each item's placement. Many rows may share one bin (shared capacity pool).
CREATE TABLE item_location (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fk_org_id   INT NOT NULL,
  item        VARCHAR(120) NOT NULL,
  color       VARCHAR(60)  NOT NULL DEFAULT '',
  size        VARCHAR(60)  NOT NULL DEFAULT '',
  qty         INT NOT NULL,
  fk_rack_id  BIGINT NOT NULL,
  module_id   VARCHAR(60)  NULL,
  module_type ENUM('Purchase Inward','Job Slip','Pack Design','Sales Return') NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_qty_pos CHECK (qty > 0),
  CONSTRAINT fk_item_rack FOREIGN KEY (fk_rack_id)
    REFERENCES rack_master(id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  INDEX idx_item_rack (fk_rack_id),
  INDEX idx_item_org (fk_org_id)
) ENGINE=InnoDB;

-- Append-only change history: who / when / before / after.
-- `user_id` is kept alongside fk_org_id on purpose: fk_org_id is the tenancy
-- filter, user_id is the ACTOR. They hold the same value today only because
-- Vastra gives us no per-person identity yet.
CREATE TABLE audit_log (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fk_org_id   INT NOT NULL,
  entity_type ENUM('rack','item_location') NOT NULL,
  entity_id   VARCHAR(60) NOT NULL,
  action      ENUM('add','update','move','remove') NOT NULL,
  before_json JSON NULL,
  after_json  JSON NULL,
  user_id     VARCHAR(60) NOT NULL DEFAULT 'system',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_org_created (fk_org_id, created_at)
) ENGINE=InnoDB;

-- Dev stub for Vastra source modules. Org-scoped like everything else; seeded
-- only when `npm run seed -- --org=<vastra_org_id>` names an owner. In
-- production USE_VASTRA_MODULES=true bypasses this table entirely and Vastra
-- scopes the data by access token.
CREATE TABLE source_transaction (
  id          VARCHAR(60) NOT NULL,
  fk_org_id   INT NOT NULL,
  module_type ENUM('Purchase Inward','Job Slip','Pack Design','Sales Return','Delivery Challan') NOT NULL,
  item        VARCHAR(120) NOT NULL,
  color       VARCHAR(60) NOT NULL DEFAULT '',
  size        VARCHAR(60) NOT NULL DEFAULT '',
  qty         INT NOT NULL,
  party       VARCHAR(120) NOT NULL DEFAULT '',
  doc_date    DATE NULL,
  PRIMARY KEY (fk_org_id, id),
  CONSTRAINT fk_src_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  INDEX idx_src_module (fk_org_id, module_type)
) ENGINE=InnoDB;
