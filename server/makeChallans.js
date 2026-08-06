import 'dotenv/config';
import { pool } from './src/db.js';
import { buildChallans, CHALLAN_COLUMNS, PICK_MODULE, PICK_PREFIX } from './challanFixtures.js';

// Add sample delivery challans to a database that ALREADY has stock, so the
// Picklist tab has something to open. Unlike `npm run seed`, this drops
// nothing — racks, stock and audit history are left exactly as they are.
//
//   node makeChallans.js            # add 14 challans
//   node makeChallans.js 30         # add 30
//   node makeChallans.js --replace  # delete the existing sample challans first
//
// Challans are generated from the stock that is actually in the racks, so a
// generated picklist resolves to real rack ids. Each one carries a size run —
// one design spread across several sizes with its own quantity per size, the
// way a real Vastra challan is laid out.

const REPLACE = process.argv.includes('--replace');
const count = Number(process.argv.find((a) => /^\d+$/.test(a))) || 14;

// The challan columns and the ENUM member arrived with the picklist feature, so
// a database seeded before it needs bringing up to date. Both are additive and
// safe to re-run.
async function ensureSchema() {
  const [cols] = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'source_transaction'`
  );
  const have = new Set(cols.map((c) => (c.column_name || c.COLUMN_NAME).toLowerCase()));

  if (!have.has('party')) {
    await pool.query("ALTER TABLE source_transaction ADD COLUMN party VARCHAR(120) NOT NULL DEFAULT ''");
    console.log('  + added source_transaction.party');
  }
  if (!have.has('doc_date')) {
    await pool.query('ALTER TABLE source_transaction ADD COLUMN doc_date DATE NULL');
    console.log('  + added source_transaction.doc_date');
  }

  // Aliased because information_schema column-name casing varies by server.
  const [[{ t: type }]] = await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'source_transaction'
       AND column_name = 'module_type'`
  );
  if (!type.includes(PICK_MODULE)) {
    await pool.query(`ALTER TABLE source_transaction MODIFY module_type
      ENUM('Purchase Inward','Job Slip','Pack Design','Sales Return','${PICK_MODULE}') NOT NULL`);
    console.log(`  + widened module_type ENUM to include ${PICK_MODULE}`);
  }
}

const [rows] = await pool.query(
  'SELECT item, color, size, SUM(qty) AS qty FROM item_location GROUP BY item, color, size'
);

if (!rows.length) {
  console.error('No stock in item_location — nothing to build challans from. Run `npm run seed` first.');
  process.exit(1);
}

console.log(`Stock: ${rows.length} distinct item/colour/size combinations.`);
await ensureSchema();

if (REPLACE) {
  const [res] = await pool.query('DELETE FROM source_transaction WHERE module_type = ?', [PICK_MODULE]);
  console.log(`  - removed ${res.affectedRows} existing challan lines`);
}

// Continue the numbering rather than colliding with challans already there.
const [[{ last }]] = await pool.query(
  'SELECT MAX(id) AS last FROM source_transaction WHERE module_type = ?',
  [PICK_MODULE]
);
const startAt = last ? Number(String(last).split('#')[0].split('-').pop()) + 1 : 1;

const lines = buildChallans(rows, { count, startAt });
if (!lines.length) {
  console.error('Could not build any challans from the current stock.');
  process.exit(1);
}
await pool.query(`INSERT INTO source_transaction ${CHALLAN_COLUMNS} VALUES ?`, [lines]);

// Report what was made, so it is obvious the size runs are there.
const docs = new Map();
for (const [id, , item, color, size, qty] of lines) {
  const doc = id.split('#')[0];
  const d = docs.get(doc) || { lines: 0, qty: 0, designs: new Set() };
  d.lines += 1; d.qty += qty; d.designs.add(`${item}|${color}`);
  docs.set(doc, d);
}
console.log(`\nAdded ${docs.size} challans (${lines.length} lines), ${PICK_PREFIX}-2026-${String(startAt).padStart(4, '0')} onwards:\n`);
for (const [doc, d] of docs) {
  console.log(`  ${doc}  ${d.designs.size} design(s), ${d.lines} size line(s), ${d.qty} units`);
}

const sample = lines.filter((l) => l[0].startsWith([...docs.keys()][0]));
console.log(`\nExample — ${[...docs.keys()][0]} (${sample[0][6]}, ${sample[0][7]}):`);
for (const [, , item, color, size, qty] of sample) {
  console.log(`  ${item.padEnd(20)} ${color.padEnd(14)} ${String(size).padEnd(10)} x${qty}`);
}
console.log('\nOpen the Picklist tab and search for one of the ids above.');
console.log('Note: the picklist reads these only when USE_VASTRA_PICKLIST=false (see README).');
await pool.end();
