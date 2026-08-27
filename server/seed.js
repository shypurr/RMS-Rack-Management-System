import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { sslConfig } from './src/db.js';
import { buildChallans, CHALLAN_COLUMNS } from './challanFixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_NAME || 'rms';

// Which organization the stub source rows belong to. source_transaction is
// org-scoped like everything else, so the seed needs an owner — and refusing to
// guess one is what keeps `npm run seed` safe to run against a database that
// already holds real organizations.
const orgFlag = process.argv.find((a) => a.startsWith('--org='));
const VASTRA_ORG_ID = orgFlag ? orgFlag.slice('--org='.length) : null;

// ── catalogue ──────────────────────────────────────────────────────────────
// Colours/sizes are per-item so the generated stock reads like real textile
// inventory (a Saree has no size, Kids Wear has its own size run).
const CATALOG = [
  { item: 'Banarasi Saree',   colors: ['Maroon', 'Red', 'Gold', 'Emerald', 'Navy'],       sizes: ['Free Size'] },
  { item: 'Cotton Saree',     colors: ['White', 'Beige', 'Sky Blue', 'Mustard'],          sizes: ['Free Size'] },
  { item: 'Anarkali Kurti',   colors: ['Red', 'Black', 'Teal', 'Peach', 'Olive'],         sizes: ['S', 'M', 'L', 'XL', 'XXL'] },
  { item: 'Rayon Kurti',      colors: ['Blue', 'Green', 'Pink', 'Grey'],                  sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Salwar Kameez',    colors: ['Cream', 'Maroon', 'Navy', 'Lavender'],            sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Bridal Lehenga',   colors: ['Red', 'Magenta', 'Gold', 'Wine'],                 sizes: ['S', 'M', 'L'] },
  { item: 'Chiffon Dupatta',  colors: ['White', 'Yellow', 'Turquoise', 'Rose'],           sizes: ['Free Size'] },
  { item: 'Formal Shirt',     colors: ['White', 'Sky Blue', 'Black', 'Lilac'],            sizes: ['38', '40', '42', '44'] },
  { item: 'Casual Shirt',     colors: ['Denim', 'Olive', 'Checked Red', 'Grey'],          sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Formal Trousers',  colors: ['Black', 'Navy', 'Charcoal', 'Beige'],             sizes: ['30', '32', '34', '36', '38'] },
  { item: 'Palazzo Pants',    colors: ['Black', 'White', 'Mustard', 'Maroon'],            sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Kids Frock',       colors: ['Pink', 'Yellow', 'Sky Blue', 'Mint'],             sizes: ['2-3Y', '4-5Y', '6-7Y', '8-9Y'] },
  { item: 'Kids Kurta Set',   colors: ['White', 'Orange', 'Green'],                       sizes: ['2-3Y', '4-5Y', '6-7Y'] },
  { item: 'Nehru Jacket',     colors: ['Black', 'Beige', 'Maroon', 'Bottle Green'],       sizes: ['38', '40', '42', '44'] },
  { item: 'Silk Stole',       colors: ['Gold', 'Silver', 'Rust', 'Indigo'],               sizes: ['Free Size'] },
  { item: 'Nightwear Set',    colors: ['Pink', 'Grey', 'Navy', 'Printed'],                sizes: ['S', 'M', 'L', 'XL'] },
];

// Inbound only — MODULES also stamps item_location.module_type, whose ENUM has
// no Delivery Challan (a challan removes stock, it is never its provenance).
const MODULES = ['Purchase Inward', 'Job Slip', 'Pack Design', 'Sales Return'];
const MODULE_PREFIX = { 'Purchase Inward': 'PI', 'Job Slip': 'JS', 'Pack Design': 'PD', 'Sales Return': 'SR' };

// ── helpers ────────────────────────────────────────────────────────────────
const pad = (n, w = 2) => String(n).padStart(w, '0');
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const rndInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

// ── generators ─────────────────────────────────────────────────────────────

// Flow A feed. Ids are what the Add Item search box matches on (LIKE on id).
function buildSourceTransactions() {
  const rows = [];
  for (const mod of MODULES) {
    for (let i = 1; i <= 18; i++) {
      const c = rnd(CATALOG);
      rows.push([
        `${MODULE_PREFIX[mod]}-2026-${pad(i, 4)}`,
        mod,
        c.item,
        rnd(c.colors),
        rnd(c.sizes),
        rndInt(5, 90),
      ]);
    }
  }
  return rows;
}

// Flow C feed (delivery challans, with size runs) lives in challanFixtures.js
// — shared with makeChallans.js, which adds challans to a database that already
// has stock instead of rebuilding everything.
// Under --empty there is no stock to build them from, so the catalogue stands
// in and every line comes out short — itself a useful state to look at.
const challanSourceFromCatalog = () =>
  CATALOG.flatMap((c) => c.colors.slice(0, 2).flatMap((color) =>
    c.sizes.map((size) => ({ item: c.item, color, size, qty: 0 }))
  ));

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  // Connect without a database so we can create it; allow multi-statement schema.
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    ssl: sslConfig(),
  });

  // Managed hosts often pre-create the database (e.g. Aiven's "defaultdb") and
  // don't grant CREATE DATABASE — tolerate that and just USE it.
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4`);
  } catch (e) {
    console.warn(`Could not create database ${DB} (${e.code}); assuming it already exists.`);
  }
  await conn.query(`USE \`${DB}\``);

  // THE destructive step, and the only one. Dropping here rather than inside a
  // .sql file is deliberate: core.sql is also applied on every server boot, so
  // it must never contain a DROP. The table definitions therefore live in one
  // place, and only this script can destroy anything.
  //
  // `organization` and `session` are NOT in this list — a reseed must never log
  // anyone out. Neither is `schema_migration`: the ledger records what has been
  // migrated, and wiping it would make one-time migrations run again.
  const DROP_ORDER = ['audit_log', 'item_location', 'source_transaction', 'rack_master'];
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of DROP_ORDER) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`Dropped ${DROP_ORDER.length} core tables.`);

  // auth.sql first: every table in core.sql has a foreign key to `organization`,
  // so the other order fails with errno 150. All CREATE TABLE IF NOT EXISTS,
  // which is why the same files serve both this script and a server boot.
  for (const file of ['auth.sql', 'picklist.sql', 'layout.sql', 'core.sql']) {
    await conn.query(await readFile(path.join(__dirname, 'migrations', file), 'utf8'));
  }
  console.log('Schema applied (auth, picklist, layout, core).');

  // No racks are seeded, ever. Each organization builds its own layout on the
  // setup screen — that is the point of the rack layout feature, and inventing
  // 100 racks inside a real customer's account would defeat it.
  if (!VASTRA_ORG_ID) {
    console.log('');
    console.log('  No --org=<vastra_org_id> given, so no stub source rows were created.');
    console.log('  Every organization starts with zero racks and configures its own');
    console.log('  layout on first login.');
    console.log('');
    await conn.end();
    return;
  }

  // source_transaction is org-scoped like everything else, so the stub rows
  // need a named owner. Refusing to guess one is what keeps this script safe to
  // run against a database that already has real organizations in it.
  const [[org]] = await conn.query(
    'SELECT id, name FROM organization WHERE vastra_org_id = ?',
    [VASTRA_ORG_ID]
  );
  if (!org) {
    console.error('');
    console.error(`  x No organization with vastra_org_id "${VASTRA_ORG_ID}".`);
    console.error('    Log in through the portal once so the row exists, then re-run.');
    console.error('');
    await conn.end();
    process.exit(1);
  }

  // ── source transactions (Flow A feed) ──
  const srcRows = buildSourceTransactions().map((r) => [org.id, ...r]);
  await conn.query(
    'INSERT INTO source_transaction (fk_org_id, id, module_type, item, color, size, qty) VALUES ?',
    [srcRows]
  );
  console.log(`Seeded ${srcRows.length} source transactions for ${org.name}.`);

  // ── delivery challans (Flow C feed) ──
  // There is no seeded stock to build these from any more, so the catalogue
  // stands in and every line reads short until the org puts real stock away.
  const challanRows = buildChallans(challanSourceFromCatalog()).map((r) => [org.id, ...r]);
  await conn.query(`INSERT INTO source_transaction ${CHALLAN_COLUMNS} VALUES ?`, [challanRows]);
  const docs = new Set(challanRows.map((r) => r[1].split('#')[0])).size;
  console.log(`Seeded ${docs} delivery challans (${challanRows.length} lines).`);

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
