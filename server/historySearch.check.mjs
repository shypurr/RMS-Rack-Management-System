// Self-check for the history filters. `node server/historySearch.check.mjs`
//
// The bug class this exists for: a WHERE clause whose "?" count drifts from the
// parameters bound to it. MySQL answers that with a 500 at request time and
// nothing before that will tell you — not a build, not a syntax check, not
// reading it.
import assert from 'node:assert/strict';
import { picklistWhere } from './src/services/picklistStore.js';
import { putawayWhere } from './src/routes/history.js';
const ok = (l) => console.log(`  ✓ ${l}`);

const holes = (clause) => (clause.match(/\?/g) || []).length;

const CASES = [
  ['no filters',            {}],
  ['search only',           { q: 'Anarkali' }],
  ['from only',             { from: '2026-09-01' }],
  ['to only',               { to: '2026-09-03' }],
  ['date range',            { from: '2026-09-01', to: '2026-09-03' }],
  ['range + search',        { from: '2026-09-01', to: '2026-09-03', q: 'Indigo' }],
  ['hash id search',        { q: '#41' }],
  ['size search',           { q: 'XL' }],
  ['blank search',          { q: '   ' }],
  ['status pending',        { status: 'pending' }],
  ['status updated',        { status: 'updated' }],
  ['everything at once',    { q: 'kurti', from: '2026-01-01', to: '2026-12-31', status: 'pending' }],
];

for (const [label, filters] of CASES) {
  const pl = picklistWhere(7, filters);
  assert.equal(holes(pl.clause), pl.params.length,
    `picklist "${label}": ${holes(pl.clause)} placeholders vs ${pl.params.length} params`);
  assert.equal(pl.params[0], 7, `picklist "${label}" must bind the org first`);
  assert.ok(pl.clause.startsWith('WHERE p.fk_org_id = ?'),
    `picklist "${label}" must filter by org — a missing tenancy predicate serves another org's data`);

  const pa = putawayWhere(7, filters);
  assert.equal(holes(pa.clause), pa.params.length,
    `putaway "${label}": ${holes(pa.clause)} placeholders vs ${pa.params.length} params`);
  assert.equal(pa.params[0], 7, `putaway "${label}" must bind the org first`);
  assert.ok(pa.clause.startsWith('WHERE fk_org_id = ?'), `putaway "${label}" must filter by org`);
}
ok(`${CASES.length} filter combinations: placeholders match bound params on both endpoints`);
ok('every combination still filters by organization');

// A blank search must not add a predicate at all, or every row LIKEs '%%'.
assert.equal(picklistWhere(7, { q: '   ' }).params.length, 1, 'blank q must add nothing');
assert.equal(putawayWhere(7, { q: '' }).params.length, 1, 'blank q must add nothing');
ok('a blank search box narrows nothing instead of matching everything');

// "#41" and "41" must both reach the id comparison as 41.
const hashed = picklistWhere(7, { q: '#41' });
assert.ok(hashed.params.includes('%41%'), '#41 must search the id as 41');
assert.ok(hashed.params.includes('%#41%'), '#41 must still match a challan literally named #41');
ok('#41 and 41 both find the picklist shown as #41');

// The date bound must be exclusive-next-day, or "to = today" drops today.
const dated = picklistWhere(7, { to: '2026-09-03' });
assert.ok(dated.clause.includes('DATE_ADD(?, INTERVAL 1 DAY)'),
  'an inclusive "to" needs the exclusive next-day bound, else today is excluded');
assert.ok(!dated.clause.includes('DATE(p.created_at)'),
  'wrapping created_at in DATE() would drop the index');
ok('the "to" date includes the whole of that day and stays index-friendly');

// Search must actually reach colour and size, which is what was asked for.
const searched = picklistWhere(7, { q: 'Indigo' });
assert.ok(searched.clause.includes('l2.color'), 'colour must be searchable');
assert.ok(searched.clause.includes('l2.size'), 'size must be searchable');
assert.ok(searched.clause.includes('l2.item'), 'item must be searchable');
const pw = putawayWhere(7, { q: 'Indigo' });
for (const path of ['$.color', '$.size', '$.item', '$.rack_id', '$.module_id']) {
  assert.ok(pw.params.includes(path), `putaway must search ${path}`);
}
ok('colour and size are searchable on both tabs');

console.log('\nhistory search checks passed\n');
