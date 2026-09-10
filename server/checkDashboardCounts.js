// Dashboard activity counters. No test framework — `node checkDashboardCounts.js`.
// Needs a reachable MySQL; skipped with a notice if it is down.
//
// The bug this exists for: "Items Added Today" read straight off
// `audit_log.action='add'` with nothing said about WHAT was added. Two
// unrelated things write that action — putting stock away
// (entity_type='item_location') and creating racks in Rack Setup
// (entity_type='rack', one row per batch). So a warehouse set up in two
// batches and then given two deliveries reported four items added, while Item
// Management showed two. Both numbers were "right"; they were counting
// different things.
//
// Rack setup is a normal first-day activity, so nothing about the inflated
// figure looks wrong from the outside — which is why it is asserted here
// rather than eyeballed.
import assert from 'node:assert/strict';
import { pool, pingDb, applyAuthSchema } from './src/db.js';

const ok = (label) => console.log(`  \u2713 ${label}`);

if (await pingDb()) {
  console.log('\n  ! MySQL unreachable - skipping dashboard checks\n');
  process.exit(0);
}
await applyAuthSchema();

const { addRacks } = await import('./src/services/layoutService.js');
const { listRacks, addItem, moveItem } = await import('./src/services/rackService.js');
const { getDashboard } = await import('./src/services/dashboardService.js');

await pool.query('DELETE FROM organization WHERE vastra_org_id = ?', ['checkdashboard']);
const [ins] = await pool.query(
  'INSERT INTO organization (vastra_org_id, name) VALUES (?, ?)', ['checkdashboard', 'Dash Co']
);
const O = ins.insertId;

// The screenshot's warehouse: racks laid out in two batches, then two
// deliveries put away. Anything counting batches as stock reports four.
await addRacks(O, { racks: 1, shelves: 1, bins: 2, bin_capacity: 100, userId: 'u' });
await addRacks(O, { racks: 1, shelves: 1, bins: 2, bin_capacity: 100, userId: 'u' });
const racks = await listRacks(O);

await addItem(O, { rackId: racks[0].id, item: 'Lower', qty: 100, userId: 'u' });
await addItem(O, { rackId: racks[1].id, item: 'tshirt', qty: 100, userId: 'u' });

const [[raw]] = await pool.query(
  "SELECT COUNT(*) AS n FROM audit_log WHERE fk_org_id = ? AND action = 'add'", [O]
);
assert.equal(raw.n, 4, 'setup precondition: 2 rack batches + 2 putaways all write action=add');
ok('rack setup and putaway both write action=add, so the action alone cannot separate them');

const dash = await getDashboard(O);
assert.equal(dash.stats.addedToday, 2,
  `"Items Added Today" must count stock, not rack batches — got ${dash.stats.addedToday}`);
ok('creating racks does not inflate "Items Added Today"');

// The same number the Item Management page arrives at from item_location.
const [[stock]] = await pool.query(
  'SELECT COUNT(*) AS n FROM item_location WHERE fk_org_id = ?', [O]
);
assert.equal(dash.stats.addedToday, stock.n,
  'the dashboard and Item Management must agree on how many items arrived today');
ok('the dashboard tile agrees with Item Management');

// The trend line is fed by a second aggregate over the same table, and the
// same omission was in it — a chart that disagrees with the tile above it.
const todaysTrend = dash.trend.at(-1);
assert.equal(todaysTrend.added, 2, `the 7-day chart must plot the same 2, got ${todaysTrend.added}`);
ok('the Activity Trend chart plots the same figure as the tile');

// Moves were never ambiguous — only stock moves. Guards the fix from being
// over-applied to a counter that was already correct.
await moveItem(O, { itemId: (await pool.query(
  'SELECT id FROM item_location WHERE fk_org_id = ? ORDER BY id LIMIT 1', [O]))[0][0].id,
  toRackId: racks[2].id, qty: 10, userId: 'u' });
const after = await getDashboard(O);
assert.equal(after.stats.movedToday, 1, 'moves today still counts the move');
assert.equal(after.stats.addedToday, 2, 'a move does not change what arrived');
ok('"Moves Today" is unaffected');

await pool.query('DELETE FROM organization WHERE id = ?', [O]);
await pool.end();
console.log('\ndashboard count checks passed\n');
