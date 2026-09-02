// Self-check for rack-group merging. `node client/src/lib/layout.check.mjs`
import assert from 'node:assert/strict';
import { mergeGroups, rangeLabel } from './layout.js';
const ok = (l) => console.log(`  ✓ ${l}`);

const g = (seq, from, to, shelves, bins, cap) => ({
  id: seq, seq, rack_from: from, rack_to: to, rack_count: to - from + 1,
  shelves, bins, bin_capacity: cap,
  bin_count: (to - from + 1) * shelves * bins,
  capacity: (to - from + 1) * shelves * bins * cap,
});

// The exact case from the screenshot: 50 + 20 + 10, where batch 3 matches batch 1.
const rows = mergeGroups([g(1,1,50,7,3,30), g(2,51,70,10,5,30), g(3,71,80,7,3,30)]);
assert.equal(rows.length, 2, '3 batches, 2 kinds of rack');
assert.equal(rows[0].rack_count, 60, '50 + 10 merged');
assert.equal(rows[0].shelves, 7);
assert.equal(rows[0].bins, 3);
assert.equal(rows[0].bin_capacity, 30);
assert.equal(rangeLabel(rows[0].ranges), 'R1–R50, R71–R80', 'non-contiguous ranges both shown');
assert.equal(rows[0].bin_count, 1050 + 210);
assert.equal(rows[0].capacity, 31500 + 6300);
assert.equal(rows[1].rack_count, 20, 'the 10x5 batch stays on its own');
assert.equal(rangeLabel(rows[1].ranges), 'R51–R70');
ok('the screenshot case: 50 + 20 + 10 becomes 60 (R1–R50, R71–R80) and 20');

// Order follows the batch that introduced each shape, not the merge.
assert.equal(rows[0].shelves, 7, 'row 1 is still the shape added first');
ok('rows keep the order their shape first appeared');

// Adjacent same-shape batches read as one unbroken range.
const adj = mergeGroups([g(1,1,50,7,3,30), g(2,51,60,7,3,30)]);
assert.equal(adj.length, 1);
assert.equal(adj[0].rack_count, 60);
assert.equal(rangeLabel(adj[0].ranges), 'R1–R60', 'touching ranges join up');
ok('adjacent batches of the same shape read as one range');

// Any single differing parameter keeps them apart.
for (const [label, alt] of [
  ['shelves', g(2,51,60,8,3,30)],
  ['bins',    g(2,51,60,7,4,30)],
  ['capacity',g(2,51,60,7,3,31)],
]) {
  const r = mergeGroups([g(1,1,50,7,3,30), alt]);
  assert.equal(r.length, 2, `differing ${label} must not merge`);
}
ok('a difference in shelves, bins or capacity keeps rows separate');

// Totals are conserved however the rows fall.
const many = [g(1,1,10,7,3,30), g(2,11,20,7,3,30), g(3,21,30,5,2,10), g(4,31,40,7,3,30)];
const merged = mergeGroups(many);
assert.equal(merged.reduce((s,r)=>s+r.rack_count,0), 40, 'no rack lost or double-counted');
assert.equal(merged.reduce((s,r)=>s+r.bin_count,0), many.reduce((s,x)=>s+x.bin_count,0));
assert.equal(merged.reduce((s,r)=>s+r.capacity,0), many.reduce((s,x)=>s+x.capacity,0));
assert.equal(merged[0].batches, 3, 'three batches folded into one row');
assert.equal(rangeLabel(merged[0].ranges), 'R1–R20, R31–R40');
ok('totals are conserved and gaps are preserved across many batches');

// Degenerate shapes.
assert.deepEqual(mergeGroups([]), []);
assert.equal(rangeLabel(mergeGroups([g(1,7,7,2,2,10)])[0].ranges), 'R7', 'a lone rack is not R7–R7');
ok('empty input and single-rack batches behave');

console.log('\nrack-group merge checks passed\n');
