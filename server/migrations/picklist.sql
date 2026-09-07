-- Picklist history (Flow C).
--
-- Deliberately NOT in core.sql: `npm run seed` drops and recreates core.sql's
-- tables on every run, and this is operational history, not demo data. Applied
-- at boot from src/index.js like auth.sql, so an existing database picks it up
-- without a reseed.
--
-- A row is written when a picklist is GENERATED, not when the racks are
-- updated. That is the whole point of `rack_updated`: it shows a picklist was
-- produced and then never acted on, which is how you find the picklist behind a
-- stock discrepancy.

CREATE TABLE IF NOT EXISTS picklist (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fk_org_id     INT NOT NULL,
  -- Optional: the challan already exists in the Vastra app, so the number is
  -- only recorded if the user chose to type it (or the module supplied it).
  dc_no         VARCHAR(60) NULL,
  party         VARCHAR(120) NOT NULL DEFAULT '',
  source        ENUM('manual','module') NOT NULL DEFAULT 'manual',
  total_qty     INT NOT NULL DEFAULT 0,
  short_qty     INT NOT NULL DEFAULT 0,
  -- 0 until Update Rack succeeds against this picklist.
  rack_updated  TINYINT NOT NULL DEFAULT 0,
  picked_qty    INT NOT NULL DEFAULT 0,
  picked_at     TIMESTAMP NULL,
  user_id       VARCHAR(60) NOT NULL DEFAULT 'system',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_picklist_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  INDEX idx_picklist_created (created_at),
  INDEX idx_picklist_updated (rack_updated),
  INDEX idx_picklist_org (fk_org_id, created_at)
) ENGINE=InnoDB;

-- Line snapshot, kept as plain text rather than a foreign key into
-- item_location: those rows get deducted, merged and deleted, and a history
-- entry has to stay readable after they are gone. `racks` is the suggested
-- allocation at generation time, which is what the printed sheet showed.
CREATE TABLE IF NOT EXISTS picklist_line (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fk_picklist_id  BIGINT NOT NULL,
  item            VARCHAR(120) NOT NULL,
  color           VARCHAR(60) NOT NULL DEFAULT '',
  size            VARCHAR(60) NOT NULL DEFAULT '',
  qty             INT NOT NULL,
  available       INT NOT NULL DEFAULT 0,
  shortage        INT NOT NULL DEFAULT 0,
  racks           VARCHAR(255) NOT NULL DEFAULT '',
  CONSTRAINT fk_line_picklist FOREIGN KEY (fk_picklist_id)
    REFERENCES picklist(id) ON DELETE CASCADE,
  INDEX idx_line_picklist (fk_picklist_id)
) ENGINE=InnoDB;
