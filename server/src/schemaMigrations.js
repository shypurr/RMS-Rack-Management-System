import { pool } from './db.js';

// One-time schema migrations, and the ledger that guarantees they are one-time.
//
// The standing migrations (auth.sql, picklist.sql, layout.sql, core.sql) are all
// CREATE TABLE IF NOT EXISTS. They are safe to re-run on every boot because they
// do nothing when the table already exists.
//
// The migrations in THIS file are different: they change or rebuild tables that
// already exist, so running one twice would be destructive. Each is recorded in
// `schema_migration` the moment it succeeds, and the ledger is checked BEFORE
// any work is attempted — so on every boot after the first, this module makes
// one cheap SELECT and does nothing else.
//
// Rules every migration here follows:
//   1. It must be a no-op when its change is already in place.
//   2. It must refuse loudly rather than touch a table holding rows, unless
//      losing those rows is provably safe.
//   3. It records itself in the ledger, so it never runs a second time even if
//      someone later reshapes the table by hand.
//
// Rule 2 has one deliberate override. A database built before organization
// scoping cannot be reshaped in place — rack identity changed from a text code
// (R05-S02-B04) to a surrogate id — so a deployment holding throwaway rows can
// otherwise never migrate itself, and every request keeps failing with
// "Unknown column 'fk_org_id'". Setting ALLOW_DESTRUCTIVE_MIGRATION=true says
// "those rows are expendable, discard them". It is read per migration, announced
// in full before anything is dropped, and needed exactly once: the ledger records
// the migration, so the variable should be removed from the environment straight
// after the deploy that used it.

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    id          VARCHAR(120) NOT NULL PRIMARY KEY,
    applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note        VARCHAR(255) NULL
  ) ENGINE=InnoDB
`;

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(table) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return rows.length > 0;
}

async function rowCount(table) {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number(row.n);
}

// Opt-in permission to destroy rows a migration cannot carry across. Off unless
// the environment says otherwise, so no deployment ever loses data by default.
const destructiveAllowed = () => process.env.ALLOW_DESTRUCTIVE_MIGRATION === 'true';

// ── the migrations ────────────────────────────────────────────────────────

const MIGRATIONS = [
  {
    id: '2026-08-27-org-tenancy-rack-identity',
    note: 'rebuild core tables with fk_org_id and numeric rack identity',

    // Only relevant to a database built before organization scoping existed.
    async needed() {
      if (!(await tableExists('rack_master'))) return false;   // core.sql will create it
      return !(await columnExists('rack_master', 'fk_org_id'));
    },

    // rack_master's identity changed from the text code (R05-S02-B04) to a
    // surrogate id plus (rack_no, shelf_no, bin_no), and item_location.fk_rack_id
    // changed from that text to a numeric foreign key. There is no ALTER that
    // reshapes this while preserving rows, so the only safe automatic path is a
    // rebuild of tables that are empty.
    async run() {
      const tables = ['audit_log', 'item_location', 'source_transaction', 'rack_master'];
      const counts = {};
      for (const t of tables) {
        counts[t] = (await tableExists(t)) ? await rowCount(t) : 0;
      }
      const populated = Object.entries(counts).filter(([, n]) => n > 0);

      if (populated.length) {
        const detail = populated.map(([t, n]) => `${t}=${n}`).join(', ');
        if (!destructiveAllowed()) {
          throw new Error(
            `Refusing to rebuild core tables: they still hold rows (${detail}). ` +
            'These tables cannot be migrated in place — rack identity changed from a ' +
            'text code to a numeric id. Export anything you need, empty them, and ' +
            'restart; or set ALLOW_DESTRUCTIVE_MIGRATION=true to discard these rows ' +
            'deliberately on the next boot.'
          );
        }
        // Say exactly what is about to be lost, before it is lost. If this line
        // appears in a log where nobody meant to set the variable, it is the
        // record of what happened.
        console.warn(
          `  ! ALLOW_DESTRUCTIVE_MIGRATION=true — discarding rows to rebuild core ` +
          `tables (${detail}). Racks and stored stock are being deleted.`
        );
      }

      // Empty, or emptying deliberately: core.sql recreates these correctly in
      // the standing pass that runs straight after this.
      await pool.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const t of tables) await pool.query(`DROP TABLE IF EXISTS \`${t}\``);
      } finally {
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');
      }
      return populated.length
        ? `rebuilt ${tables.length} tables, discarding ${populated.map(([t, n]) => `${t}=${n}`).join(', ')}`
        : `rebuilt ${tables.length} empty tables`;
    },
  },

  {
    id: '2026-08-27-picklist-org-column',
    note: 'add picklist.fk_org_id',

    async needed() {
      if (!(await tableExists('picklist'))) return false;      // picklist.sql will create it
      return !(await columnExists('picklist', 'fk_org_id'));
    },

    async run() {
      const n = await rowCount('picklist');
      if (n > 0) {
        if (!destructiveAllowed()) {
          throw new Error(
            `Refusing to add picklist.fk_org_id: the table holds ${n} rows and there ` +
            'is no way to know which organization each belongs to. Empty the table, ' +
            'assign owners by hand, or set ALLOW_DESTRUCTIVE_MIGRATION=true to ' +
            'discard them on the next boot.'
          );
        }
        console.warn(
          `  ! ALLOW_DESTRUCTIVE_MIGRATION=true — discarding ${n} picklist rows ` +
          'so the organization column can be added.'
        );
        // picklist_line has a foreign key onto picklist; clear the children first.
        if (await tableExists('picklist_line')) await pool.query('DELETE FROM picklist_line');
        await pool.query('DELETE FROM picklist');
      }
      await pool.query(
        `ALTER TABLE picklist
           ADD COLUMN fk_org_id INT NOT NULL,
           ADD CONSTRAINT fk_picklist_org FOREIGN KEY (fk_org_id)
             REFERENCES organization(id) ON DELETE CASCADE`
      );
      return 'column added';
    },
  },

  {
    id: '2026-09-02-rack-groups',
    note: 'convert base-grid + overrides into an ordered list of rack groups',

    // Only for a database that already has bins but no rack_group rows to
    // describe them.
    //
    // rack_group is created by the STANDING pass, which runs after this one
    // (see applySchema in db.js). So on the very boot that deploys this change
    // the table does not exist yet — treating that as "not needed" would record
    // the migration as done and leave the existing racks permanently
    // undescribed. A missing table means "definitely needed"; run() creates it.
    async needed() {
      if (!(await tableExists('rack_master'))) return false;
      if ((await rowCount('rack_master')) === 0) return false;
      if (!(await tableExists('rack_group'))) return true;
      return (await rowCount('rack_group')) === 0;
    },

    // Rule 2 does not bite here: this migration WRITES rack_group and never
    // touches rack_master, so the bins — and therefore the stock — are provably
    // unaffected. It is safe on a populated database, which is the point.
    //
    // The groups are derived from the bins that actually exist, NOT from
    // rack_layout/rack_group_override. Config and reality can disagree (an
    // apply that half-failed, a hand-edited row), and it is the bins that the
    // user sees and stores stock in. Deriving from them guarantees the screen
    // describes the warehouse rather than a stale intention.
    async run() {
      // Create the table this migration fills, because the standing pass that
      // normally creates it has not run yet on this boot. IF NOT EXISTS makes
      // both orderings safe: whichever gets there first wins and the other is a
      // no-op. Keep in step with the definition in migrations/layout.sql.
      await pool.query(
        `CREATE TABLE IF NOT EXISTS rack_group (
           id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           fk_org_id    INT NOT NULL,
           seq          INT NOT NULL,
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
         ) ENGINE=InnoDB`
      );

      // One row per rack: its shape, and whether every bin in it agrees on a
      // capacity. MIN/MAX differing means the rack is not uniform and cannot be
      // folded into a group with a single bin_capacity.
      const [racks] = await pool.query(
        `SELECT fk_org_id, rack_no,
                MAX(shelf_no) AS shelves, MAX(bin_no) AS bins,
                MIN(capacity) AS min_cap, MAX(capacity) AS max_cap,
                COUNT(*) AS bin_count
         FROM rack_master
         GROUP BY fk_org_id, rack_no
         ORDER BY fk_org_id, rack_no`
      );

      // Fold consecutive racks of an identical shape into one group. The
      // algorithm lives in layoutService next to binsForGroup, its inverse, and
      // is checked by checkLayout.js — it has to round-trip exactly or this
      // migration would misdescribe a real warehouse.
      const { coalesceRackGroups } = await import('./services/layoutService.js');
      const groups = coalesceRackGroups(racks);

      // seq restarts per organization — it is the order within one org's list.
      const seqByOrg = new Map();
      for (const g of groups) {
        const seq = (seqByOrg.get(g.fk_org_id) || 0) + 1;
        seqByOrg.set(g.fk_org_id, seq);
        await pool.query(
          `INSERT INTO rack_group
             (fk_org_id, seq, rack_from, rack_to, shelves, bins, bin_capacity)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [g.fk_org_id, seq, g.rack_from, g.rack_to, g.shelves, g.bins, g.bin_capacity]
        );
      }

      // The grid columns stop being written from here on, so they must stop
      // being required. Dropping the CHECK first: it references the columns and
      // would otherwise reject the NULLs the table can now hold.
      // Both are tolerated as already-done — a database created after this
      // change ships the new shape from layout.sql and has neither to alter.
      try {
        await pool.query('ALTER TABLE rack_layout DROP CHECK chk_layout_positive');
      } catch (err) {
        if (err.code !== 'ER_CHECK_NOT_FOUND' && err.errno !== 3940) throw err;
      }
      await pool.query(
        `ALTER TABLE rack_layout
           MODIFY racks INT NULL, MODIFY shelves INT NULL,
           MODIFY bins INT NULL, MODIFY bin_capacity INT NULL`
      );

      const ragged = groups.filter((g) => !g.uniform).length;
      return `${groups.length} group(s) across ${seqByOrg.size} org(s) from ${racks.length} rack(s)` +
        (ragged ? `; ${ragged} ragged rack(s) kept as single-rack groups` : '');
    },
  },
];

// ── the runner ────────────────────────────────────────────────────────────

// Returns a list of what it did, so the caller can log it. On a database that is
// already up to date this performs exactly one SELECT against the ledger and
// returns an empty array — that is what stops it "running every startup".
export async function applyOneTimeMigrations() {
  await pool.query(LEDGER);
  const [applied] = await pool.query('SELECT id FROM schema_migration');
  const done = new Set(applied.map((r) => r.id));

  const performed = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;              // already run — never again

    if (!(await m.needed())) {
      // Nothing to do (fresh database, or someone already fixed it by hand).
      // Record it anyway so the check is skipped from here on.
      await pool.query(
        'INSERT IGNORE INTO schema_migration (id, note) VALUES (?, ?)',
        [m.id, 'not needed on this database']
      );
      continue;
    }

    const result = await m.run();              // throws to abort — nothing recorded
    await pool.query(
      'INSERT INTO schema_migration (id, note) VALUES (?, ?)',
      [m.id, `${m.note}: ${result}`]
    );
    performed.push(`${m.id} (${result})`);
  }
  return performed;
}
