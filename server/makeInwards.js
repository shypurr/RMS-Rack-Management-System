import 'dotenv/config';
import { pool } from './src/db.js';
import { buildInwards, INWARD_COLUMNS, CATALOG, INWARD_MODULES } from './inwardFixtures.js';

// Add MULTI-LINE inward documents to a database that already has racks, so
// Putaway has something with more than one item on it to open.
//
//   node makeInwards.js                 # add 6 documents
//   node makeInwards.js 12              # add 12
//   node makeInwards.js --replace       # delete previously generated ones first
//   node makeInwards.js --org=<vastra_org_id>
//
// Why this exists: `npm run seed` also builds these, but it DROPS AND REBUILDS
// everything — racks, stock, audit history. Once a database is in use that is
// not something you run to get a few more documents to put away. This adds them
// to a live database instead, and like makeChallans.js it drops nothing.
//
// Both use the same generator (inwardFixtures.js), so what this adds is shaped
// exactly like what a fresh seed builds. The stub spreads one document's lines
// over "PI-2026-9001#1, #2…" because source_transaction.id is its primary key;
// the part before the "#" is the document number, which is what Putaway groups
// on. Live Vastra needs no such trick — there one masterNo simply repeats.

const REPLACE = process.argv.includes('--replace');
const count = Number(process.argv.find((a) => /^\d+$/.test(a))) || 6;

const orgFlag = process.argv.find((a) => a.startsWith('--org='));
const VASTRA_ORG_ID = orgFlag ? orgFlag.slice('--org='.length) : null;

// Generated documents are numbered from 9001 so they never collide with the
// 0001-0018 range seed.js uses, and so --replace can find them again.
const START_AT = 9001;

async function resolveOrg() {
  if (VASTRA_ORG_ID) {
    const [[org]] = await pool.query(
      'SELECT id, name FROM organization WHERE vastra_org_id = ?', [VASTRA_ORG_ID]
    );
    if (!org) {
      console.error(`No organization with vastra_org_id "${VASTRA_ORG_ID}".`);
      process.exit(1);
    }
    return org;
  }
  // Unlike makeChallans.js this does not need stock — an inward is what puts
  // stock there in the first place. Racks are what it needs.
  const [orgs] = await pool.query(
    `SELECT o.id, o.name, COUNT(rm.id) AS racks
     FROM organization o JOIN rack_master rm ON rm.fk_org_id = o.id
     GROUP BY o.id ORDER BY racks DESC`
  );
  if (!orgs.length) {
    console.error('No organization has any racks. Set up racks first, then re-run.');
    process.exit(1);
  }
  if (orgs.length > 1) {
    console.error('More than one organization has racks:');
    for (const o of orgs) console.error(`  - ${o.name} (${o.racks} bins)`);
    console.error('Re-run with --org=<vastra_org_id> to say which one.');
    process.exit(1);
  }
  return orgs[0];
}

const ORG = await resolveOrg();

if (REPLACE) {
  const [res] = await pool.query(
    "DELETE FROM source_transaction WHERE fk_org_id = ? AND id REGEXP '-2026-9[0-9]{3}#'",
    [ORG.id]
  );
  console.log(`Removed ${res.affectedRows} previously generated inward line(s).`);
}

// One document per module, `count` times over — the same generator seed.js
// uses, so what you add here is shaped exactly like what a fresh seed builds.
const perModule = Math.max(1, Math.ceil(count / INWARD_MODULES.length));
const rows = buildInwards(CATALOG, { count: perModule, startAt: START_AT })
  .map((r) => [ORG.id, ...r]);
await pool.query(`INSERT INTO source_transaction ${INWARD_COLUMNS} VALUES ?`, [rows]);

const docs = new Set(rows.map((r) => r[1].split('#')[0]));
console.log(`Added ${docs.size} multi-line inward document(s), ${rows.length} lines, to ${ORG.name}:`);
for (const d of docs) {
  const n = rows.filter((r) => r[1].startsWith(`${d}#`)).length;
  console.log(`  ${d} — ${n} item${n > 1 ? 's' : ''}`);
}
console.log('\nOpen Putaway, pick one of these in Step 1, and every line fills in below.');

await pool.end();
