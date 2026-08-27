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
