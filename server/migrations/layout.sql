-- Per-organization rack layout configuration.
--
-- Like auth.sql and picklist.sql, deliberately NOT in schema.sql: that file
-- drops and recreates its tables on every `npm run seed`, and a layout is an
-- organization's real configuration, not demo data. All CREATE TABLE IF NOT
-- EXISTS, applied at boot from src/index.js.
--
-- These two tables describe the layout; rack_master holds the bins actually
-- generated from them. rack_master is the source of truth for stock — these
-- exist to prefill the form and compute the next change's diff.

-- The base grid. One row per organization.
CREATE TABLE IF NOT EXISTS rack_layout (
  fk_org_id    INT NOT NULL PRIMARY KEY,
  racks        INT NOT NULL,
  shelves      INT NOT NULL,
  bins         INT NOT NULL,
  bin_capacity INT NOT NULL,
  -- Optimistic lock. Every apply bumps it; an apply carrying a stale version is
  -- rejected, so two people editing at once cannot half-apply a layout.
  version      INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_layout_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  CONSTRAINT chk_layout_positive CHECK (racks > 0 AND shelves > 0 AND bins > 0 AND bin_capacity > 0)
) ENGINE=InnoDB;

-- Rack ranges that differ from the base grid. Ranges may not overlap (enforced
-- in layoutService, not expressible as a CHECK). A NULL column inherits the
-- base value. A single-rack override is the degenerate range from = to.
CREATE TABLE IF NOT EXISTS rack_group_override (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fk_org_id    INT NOT NULL,
  rack_from    INT NOT NULL,
  rack_to      INT NOT NULL,
  shelves      INT NULL,
  bins         INT NULL,
  bin_capacity INT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_override_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  CONSTRAINT chk_override_range CHECK (rack_to >= rack_from AND rack_from > 0),
  INDEX idx_override_org (fk_org_id, rack_from)
) ENGINE=InnoDB;
