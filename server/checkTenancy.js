// Cross-organization isolation check. No test framework — `node checkTenancy.js`.
// Creates two organizations, gives each its own layout and stock, and asserts
// that neither can see or touch the other's rows through any code path.
// Needs a reachable MySQL; skipped with a notice if it is down.
import assert from 'node:assert/strict';
import { pool, pingDb, applyAuthSchema } from './src/db.js';

const ok = (label) => console.log(`  \u2713 ${label}`);

if (await pingDb()) {
  console.log('\n  ! MySQL unreachable - skipping tenancy checks\n');
  process.exit(0);
}
await applyAuthSchema();

const { addRacks } = await import('./src/services/layoutService.js');
const { listRacks, addItem, getRackWithItems, findPlacements, moveItem, updateItemQty } =
  await import('./src/services/rackService.js');
const { getDashboard } = await import('./src/services/dashboardService.js');

async function makeOrg(vastraId, name) {
  await pool.query('DELETE FROM organization WHERE vastra_org_id = ?', [vastraId]);
  const [ins] = await pool.query(
    'INSERT INTO organization (vastra_org_id, name) VALUES (?, ?)', [vastraId, name]
  );
  return ins.insertId;
}

const A = await makeOrg('checktenancy-a', 'Org A');
const B = await makeOrg('checktenancy-b', 'Org B');

// Deliberately different layouts — this is the whole point of the feature.
await addRacks(A, { racks: 2, shelves: 2, bins: 2, bin_capacity: 100, userId: 'a' });
await addRacks(B, { racks: 5, shelves: 1, bins: 1, bin_capacity: 50, userId: 'b' });

const racksA = await listRacks(A);
const racksB = await listRacks(B);
assert.equal(racksA.length, 8, 'org A has 2x2x2 bins');
assert.equal(racksB.length, 5, 'org B has 5x1x1 bins');
assert.equal(racksA[0].rack_id, 'R01-S01-B01');
ok('each organization gets its own independent rack layout');

// Stock added by A must be invisible to B.
await addItem(A, { rackId: racksA[0].id, item: 'Cotton Twill', color: 'Navy', size: 'L', qty: 30, userId: 'a' });
await addItem(B, { rackId: racksB[0].id, item: 'Denim 12oz', color: 'Indigo', size: 'M', qty: 10, userId: 'b' });

const [aItems] = await pool.query('SELECT item FROM item_location WHERE fk_org_id = ?', [A]);
assert.deepEqual(aItems.map((r) => r.item), ['Cotton Twill']);
ok('stock rows carry the organization that created them');

assert.equal((await findPlacements(B, { item: 'Cotton Twill', color: 'Navy', size: 'L' })).length, 0);
assert.equal((await findPlacements(A, { item: 'Cotton Twill', color: 'Navy', size: 'L' })).length, 1);
ok("findPlacements never returns another organization's stock");

// A rack id belonging to A must be a 404 for B, not a readable row.
await assert.rejects(getRackWithItems(B, racksA[0].id), /not found/i);
ok("reading another organization's rack by id is a 404");

// Writes across the boundary must fail too — this is the dangerous half.
await assert.rejects(
  addItem(B, { rackId: racksA[1].id, item: 'Sneaky', qty: 1, userId: 'b' }),
  /not found/i
);
ok("adding stock into another organization's rack is refused");

const [[aRow]] = await pool.query('SELECT id FROM item_location WHERE fk_org_id = ? LIMIT 1', [A]);
await assert.rejects(updateItemQty(B, { id: aRow.id, qty: 1, userId: 'b' }), /not found/i);
await assert.rejects(
  moveItem(B, { itemId: aRow.id, toRackId: racksB[1].id, qty: 1, userId: 'b' }),
  /not found/i
);
ok("editing or moving another organization's stock is refused");

// The original symptom: identical dashboards.
const dashA = await getDashboard(A);
const dashB = await getDashboard(B);
assert.equal(dashA.stats.totalItems, 30);
assert.equal(dashB.stats.totalItems, 10);
assert.equal(dashA.stats.totalRacks, 8);
assert.equal(dashB.stats.totalRacks, 5);
assert.notDeepEqual(dashA.stats, dashB.stats);
ok('dashboards differ per organization - the reported bug is gone');

// Audit rows and picklists must be scoped too — they are the other two places
// a user reads history from.
const { listPicklists, savePicklist } = await import('./src/services/picklistStore.js');

await savePicklist(A, {
  id: null, dcNo: 'DC-A-1', party: 'Party A', source: 'manual', userId: 'a',
  rows: [{
    item: 'Cotton Twill', color: 'Navy', size: 'L', qty: 5,
    available: 30, shortage: 0, placements: [{ rack_id: 'R01-S01-B01', suggested: 5 }],
  }],
});
assert.equal((await listPicklists(A, 100)).length, 1);
assert.equal((await listPicklists(B, 100)).length, 0);
ok('picklist history is per organization');

const [[auditA]] = await pool.query('SELECT COUNT(*) AS n FROM audit_log WHERE fk_org_id = ?', [A]);
const [[auditB]] = await pool.query('SELECT COUNT(*) AS n FROM audit_log WHERE fk_org_id = ?', [B]);
assert.ok(auditA.n > 0 && auditB.n > 0, 'both orgs wrote audit rows');
const [[crossed]] = await pool.query(
  'SELECT COUNT(*) AS n FROM audit_log WHERE fk_org_id = ? AND user_id = ?', [A, 'b']
);
assert.equal(crossed.n, 0, 'no audit row is filed under the wrong organization');
ok('audit rows are filed against the organization that caused them');

await pool.query('DELETE FROM organization WHERE id IN (?, ?)', [A, B]);
await pool.end();
console.log('\ntenancy checks passed\n');
