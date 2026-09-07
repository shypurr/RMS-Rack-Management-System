-- Per-organization rack layout configuration.
--
-- Like auth.sql and picklist.sql, deliberately NOT in core.sql: `npm run seed`
-- drops and recreates core.sql's tables on every run, and a layout is an
-- organization's real configuration, not demo data. All CREATE TABLE IF NOT
-- EXISTS, applied at boot from src/index.js.
--
-- These two tables describe the layout; rack_master holds the bins actually
-- generated from them. rack_master is the source of truth for stock — these
-- exist to prefill the form and compute the next change's diff.

-- Per-organization layout header. One row per organization.
--
-- The four grid columns are LEGACY: they described the old base grid, which
-- rack_group replaced. They are nullable and no longer written — the shape of
-- the racks now lives entirely in rack_group. What survives here is `version`,
-- the row this table exists to lock, and the row an org's layout hangs off.
CREATE TABLE IF NOT EXISTS rack_layout (
  fk_org_id    INT NOT NULL PRIMARY KEY,
  racks        INT NULL,
  shelves      INT NULL,
  bins         INT NULL,
  bin_capacity INT NULL,
  -- Bumped on every change so the audit trail and any future concurrent editor
  -- can tell one revision of the layout from the next. Adding racks does not
  -- need it as a lock: the next rack number is computed inside the transaction
  -- with this row held FOR UPDATE, so two appends queue instead of colliding.
  version      INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_layout_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One row per batch of racks the user added, in the order they added them.
--
-- This SUPERSEDES the rack_layout grid columns and rack_group_override below.
-- The old model was a base grid plus ranges that differ from it, which meant
-- the user had to understand "base" and "exception" before they could describe
-- their own warehouse. This one is a plain list: each time you add racks you
-- say how many and what shape, and they are appended after the ones already
-- there. No base, no exceptions, no overlap rules.
--
-- rack_from/rack_to are PINNED when the batch is added, not derived from the
-- row order. Removing racks is a separate feature that will be able to leave a
-- gap in the numbering, and a derived range could not represent that.
CREATE TABLE IF NOT EXISTS rack_group (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fk_org_id    INT NOT NULL,
  seq          INT NOT NULL,           -- display order, 1-based
  rack_from    INT NOT NULL,
  rack_to      INT NOT NULL,
  shelves      INT NOT NULL,
  bins         INT NOT NULL,
  bin_capacity INT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rack_group_org FOREIGN KEY (fk_org_id)
    REFERENCES organization(id) ON DELETE CASCADE,
  CONSTRAINT chk_rack_group_range CHECK (rack_to >= rack_from AND rack_from > 0),
  CONSTRAINT chk_rack_group_shape CHECK (shelves > 0 AND bins > 0 AND bin_capacity > 0),
  INDEX idx_rack_group_org (fk_org_id, seq)
) ENGINE=InnoDB;

-- ── superseded by rack_group, kept for rollback ────────────────────────────
-- Nothing reads these any more. rack_layout survives only as the holder of the
-- per-org `version` counter; its grid columns are no longer written. They are
-- left in place rather than dropped so a deploy that goes wrong can be put back
-- without restoring from a backup — rack_master, the actual source of truth for
-- stock, is untouched by the change either way.

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
