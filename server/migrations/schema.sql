-- Rack Management System — schema (MySQL / InnoDB)
-- Applied by seed.js. Safe to re-run: drops and recreates.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS item_location;
DROP TABLE IF EXISTS source_transaction;
DROP TABLE IF EXISTS rack_master;
SET FOREIGN_KEY_CHECKS = 1;

-- Master record of every physical rack/bin location.
-- `used` is kept in sync by the app (= SUM of item_location.qty for the rack).
-- `status` is derived: Vacant when used = 0, else Occupied.
CREATE TABLE rack_master (
  rack_id   VARCHAR(20) NOT NULL PRIMARY KEY,          -- R{n}-S{n}-B{n}, e.g. R05-S02-B04
  capacity  INT NOT NULL,
  used      INT NOT NULL DEFAULT 0,
  status    ENUM('Vacant','Occupied') NOT NULL DEFAULT 'Vacant',
  CONSTRAINT chk_used_nonneg CHECK (used >= 0),
  CONSTRAINT chk_used_capacity CHECK (used <= capacity)
) ENGINE=InnoDB;

-- Each item's placement. Many rows may share one rack (shared capacity pool).
CREATE TABLE item_location (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item        VARCHAR(120) NOT NULL,
  -- Vastra's itemTypeID for the design. '' for manual entries and for rows
  -- added before the column existed; backfilled on the next merging add/move.
  item_code   VARCHAR(60)  NOT NULL DEFAULT '',
  color       VARCHAR(60)  NOT NULL DEFAULT '',
  size        VARCHAR(60)  NOT NULL DEFAULT '',
  qty         INT NOT NULL,
  fk_rack_id  VARCHAR(20) NOT NULL,
  module_id   VARCHAR(60)  NULL,
  module_type ENUM('Purchase Inward','Job Slip','Pack Design','Sales Return') NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_qty_pos CHECK (qty > 0),
  CONSTRAINT fk_item_rack FOREIGN KEY (fk_rack_id)
    REFERENCES rack_master(rack_id) ON UPDATE CASCADE,
  INDEX idx_item_rack (fk_rack_id)
) ENGINE=InnoDB;

-- Append-only change history: who / when / before / after.
CREATE TABLE audit_log (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('rack','item_location') NOT NULL,
  entity_id   VARCHAR(60) NOT NULL,
  action      ENUM('add','update','move','remove') NOT NULL,
  before_json JSON NULL,
  after_json  JSON NULL,
  user_id     VARCHAR(60) NOT NULL DEFAULT 'system',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;

-- Stub for Vastra source modules until real integration.
-- Feeds Flow A auto-fill (Purchase Inward / Job Slip / Pack Design / Sales Return).
CREATE TABLE source_transaction (
  id          VARCHAR(60) NOT NULL PRIMARY KEY,
  module_type ENUM('Purchase Inward','Job Slip','Pack Design','Sales Return') NOT NULL,
  item        VARCHAR(120) NOT NULL,
  item_code   VARCHAR(60) NOT NULL DEFAULT '',   -- mirrors Vastra's itemTypeID
  color       VARCHAR(60) NOT NULL DEFAULT '',
  size        VARCHAR(60) NOT NULL DEFAULT '',
  qty         INT NOT NULL,
  INDEX idx_src_module (module_type)
) ENGINE=InnoDB;
