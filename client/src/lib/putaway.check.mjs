// Self-check for Putaway line arithmetic. `node client/src/lib/putaway.check.mjs`
//
// The rule under test: a line can never put away more than it says it has.
// Editing the counted quantity DOWN after racks are chosen is the way to break
// it, and the failure is silent — the screen looks fine, the database gets
// stock nobody received.
import assert from 'node:assert/strict';
import { allocatedOn, remainingOn, allocCeiling, withQty } from './putaway.js';
const ok = (l) => console.log(`  ✓ ${l}`);

const row = (qty, ...allocQtys) => ({
  item: 'Anarkali Kurti', qty: String(qty),
  allocs: allocQtys.map((q, i) => ({ key: `a${i}`, rackId: i + 1, qty: q === null ? '' : String(q) })),
});

// The invariant, stated once.
const invariant = (r, label) =>
  assert.ok(allocatedOn(r) <= Number(r.qty || 0),
    `${label}: ${allocatedOn(r)} allocated on a line of ${r.qty}`);

// Raising the quantity leaves the racks alone.
let r = withQty(row(90, 30, 30, 30), '120');
assert.equal(allocatedOn(r), 90, 'raising qty must not touch existing racks');
assert.equal(remainingOn(r), 30);
invariant(r, 'raised');
ok('raising the counted quantity leaves chosen racks untouched');

// Lowering it below what is allocated trims from the LAST rack backwards.
r = withQty(row(90, 30, 30, 30), '70');
assert.equal(allocatedOn(r), 70, 'must trim to the new quantity');
assert.deepEqual(r.allocs.map((a) => a.qty), ['30', '30', '10'], 'trim the last rack first');
invariant(r, 'trimmed one');
ok('lowering the quantity trims the most recently added rack first');

// A trim spanning several racks empties them rather than leaving 0.
r = withQty(row(90, 30, 30, 30), '30');
assert.equal(allocatedOn(r), 30);
assert.deepEqual(r.allocs.map((a) => a.qty), ['30', '', ''], "emptied boxes read as blank, not '0'");
invariant(r, 'trimmed many');
ok('a trim across several racks blanks them instead of leaving zeros');

// Down to nothing, and to blank.
for (const v of ['0', '']) {
  r = withQty(row(90, 30, 30, 30), v);
  assert.equal(allocatedOn(r), 0, `qty "${v}" must clear every allocation`);
  invariant(r, `qty "${v}"`);
}
ok('clearing or zeroing the quantity releases every rack');

// The first rack — the one chosen most deliberately — survives longest.
r = withQty(row(50, 20, 20, 10), '20');
assert.equal(r.allocs[0].qty, '20', 'the first rack chosen should be the last one trimmed');
ok('the first rack chosen is the last one given up');

// Junk never produces NaN or a negative.
for (const v of ['abc', '-5', '1e5', '3.7']) {
  r = withQty(row(10, 5), v);
  assert.ok(/^\d*$/.test(r.qty), `qty "${v}" produced "${r.qty}"`);
  invariant(r, `junk "${v}"`);
}
ok('junk input never yields NaN, a negative, or a broken invariant');

// The per-rack ceiling: unallocated plus what that box already holds.
const base = row(90, 30, 30, null);
assert.equal(allocCeiling(base, base.allocs[2]), 30, 'empty third box may take the remaining 30');
assert.equal(allocCeiling(base, base.allocs[0]), 60, 'an existing box may grow into what is free');
assert.equal(allocCeiling(row(90, 45, 45), { key: 'x', qty: '' }), 0,
  'a fully placed line offers nothing to a new rack');
ok('a rack box can never take the line past its own total');

// Editing qty then re-checking remaining drives the "another rack" button.
r = withQty(row(90, 90), '100');
assert.equal(remainingOn(r), 10, 'raising qty reopens the option to add a rack');
r = withQty(row(90, 90), '90');
assert.equal(remainingOn(r), 0, 'a fully placed line offers no further rack');
ok('"another rack" appears exactly when something still needs one');

// Property sweep: no sequence of quantity edits can break the invariant.
for (let t = 0; t < 2000; t++) {
  let cur = row(
    1 + Math.floor(Math.random() * 200),
    ...Array.from({ length: 1 + Math.floor(Math.random() * 4) },
      () => Math.floor(Math.random() * 60))
  );
  for (let e = 0; e < 5; e++) {
    cur = withQty(cur, String(Math.floor(Math.random() * 250)));
    invariant(cur, 'random edit sequence');
  }
}
ok('2000 random quantity-edit sequences never over-allocate a line');

console.log('\nputaway arithmetic checks passed\n');

// ── rack suggestion ────────────────────────────────────────────────────────
{
  const { suggestRacks, indexPlacements, stockKey } = await import('./putaway.js');
  const rack = (id, available, capacity = 10) => ({ id, available, capacity, rack_id: `R${id}`, status: available === capacity ? 'Vacant' : 'Occupied' });
  const line = (item, color, size, qty, ...allocs) => ({
    item, color, size, qty: String(qty), saved: false,
    allocs: allocs.length ? allocs : [{ key: 'a0', rackId: null, qty: '' }],
  });
  const placed = (r) => r.allocs.filter((a) => a.rackId).map((a) => [a.rackId, Number(a.qty)]);

  // The headline case: one line far bigger than any single bin.
  let racks = [rack(1, 10), rack(2, 10), rack(3, 10), rack(4, 10), rack(5, 10)];
  let out = suggestRacks([line('Lehenga', 'Magenta', 'M', 45)], racks);
  assert.equal(allocatedOn(out[0]), 45, '45 units must be fully placed');
  assert.equal(remainingOn(out[0]), 0);
  assert.equal(placed(out[0]).length, 5, '45 across 10-unit bins needs 5 bins');
  assert.deepEqual(placed(out[0]).map(([, q]) => q), [10, 10, 10, 10, 5], 'fill each bin then spill');
  invariant(out[0], 'suggested');
  ok('a line larger than any bin is spread across exactly enough bins');

  // Same item first: R9 already holds this product, so it is topped up before
  // emptier racks are touched.
  racks = [rack(8, 10), rack(9, 4), rack(10, 10)];
  const stock = [{ fk_rack_id: 9, item: 'Lehenga', color: 'Magenta', size: 'M', qty: 6 }];
  out = suggestRacks([line('Lehenga', 'Magenta', 'M', 12)], racks, indexPlacements(stock));
  assert.equal(placed(out[0])[0][0], 9, 'the rack already holding this item comes first');
  assert.equal(placed(out[0])[0][1], 4, 'it is filled to its remaining capacity');
  assert.ok(out[0].allocs[0].consolidated, 'consolidated racks are flagged for the UI');
  assert.equal(allocatedOn(out[0]), 12);
  ok('racks already holding the same item are topped up first');

  // A DIFFERENT colour is a different product and must not consolidate.
  out = suggestRacks([line('Lehenga', 'Red', 'M', 4)], racks, indexPlacements(stock));
  assert.ok(!out[0].allocs[0].consolidated, 'a different colour is a different product');
  ok('a different colour or size does not count as the same product');

  // Capacity contention — the reason the free ledger exists. Three lines, one
  // shared set of bins: no bin may be promised twice.
  racks = [rack(1, 10), rack(2, 10), rack(3, 10)];
  out = suggestRacks([
    line('A', '', '', 15), line('B', '', '', 10), line('C', '', '', 5),
  ], racks);
  const perRack = new Map();
  for (const r of out) for (const [id, q] of placed(r)) perRack.set(id, (perRack.get(id) || 0) + q);
  for (const [id, used] of perRack) {
    const cap = racks.find((x) => x.id === id).available;
    assert.ok(used <= cap, `rack ${id}: promised ${used} into ${cap} of space`);
  }
  assert.equal([...perRack.values()].reduce((s, x) => s + x, 0), 30, 'all 30 units placed across 30 of space');
  ok('three competing lines never promise the same bin twice');

  // Not enough space anywhere: place what fits, leave the rest visibly unplaced.
  racks = [rack(1, 3), rack(2, 2)];
  out = suggestRacks([line('A', '', '', 50)], racks);
  assert.equal(allocatedOn(out[0]), 5, 'places only what exists');
  assert.equal(remainingOn(out[0]), 45, 'the shortfall stays visible');
  invariant(out[0], 'insufficient space');
  ok('when the warehouse is full it places what fits and shows the rest as unplaced');

  // Hand-made choices survive, and only the remainder is filled.
  racks = [rack(1, 10), rack(2, 10), rack(3, 10)];
  out = suggestRacks([line('A', '', '', 25, { key: 'm', rackId: 3, qty: '7' })], racks);
  assert.equal(out[0].allocs[0].rackId, 3, 'a hand-picked rack is not moved');
  assert.equal(out[0].allocs[0].qty, '7', 'a hand-picked quantity is not changed');
  assert.equal(allocatedOn(out[0]), 25);
  assert.ok(!placed(out[0]).slice(1).some(([id]) => id === 3), 'it does not add a second box for the same rack');
  ok('racks you chose yourself are left exactly as they are');

  // Idempotent: pressing the button twice changes nothing and adds no boxes.
  const once = suggestRacks([line('A', '', '', 25)], racks);
  const twice = suggestRacks(once, racks);
  assert.deepEqual(placed(twice[0]), placed(once[0]), 'a second press must be a no-op');
  assert.equal(twice[0].allocs.length, once[0].allocs.length, 'and must not append empty boxes');
  ok('pressing Suggest twice is a no-op');

  // Saved lines and blank lines are skipped.
  const savedRow = { ...line('A', '', '', 10), saved: true };
  assert.deepEqual(suggestRacks([savedRow], racks)[0], savedRow, 'an already put-away line is untouched');
  assert.equal(allocatedOn(suggestRacks([line('', '', '', 10)], racks)[0]), 0, 'a nameless line gets nothing');
  ok('already put-away lines and blank lines are left alone');

  // Property sweep against the real shape: capacity is never oversubscribed.
  for (let t = 0; t < 500; t++) {
    const rs = Array.from({ length: 3 + Math.floor(Math.random() * 8) },
      (_, i) => rack(i + 1, Math.floor(Math.random() * 12)));
    const ls = Array.from({ length: 1 + Math.floor(Math.random() * 6) },
      (_, i) => line(`I${i % 3}`, '', '', 1 + Math.floor(Math.random() * 60)));
    const res = suggestRacks(ls, rs);
    const used = new Map();
    for (const r of res) {
      invariant(r, 'random suggest');
      for (const [id, q] of placed(r)) used.set(id, (used.get(id) || 0) + q);
    }
    for (const [id, u] of used) {
      assert.ok(u <= rs.find((x) => x.id === id).available,
        `rack ${id} oversubscribed: ${u} into ${rs.find((x) => x.id === id).available}`);
    }
  }
  ok('500 random warehouses: no bin is ever oversubscribed and no line over-allocated');
}

console.log('\nrack suggestion checks passed\n');

// ── live free space across the table ───────────────────────────────────────
// The bug this covers: the rack picker read raw database availability, so a bin
// that row 1 had just claimed still advertised itself to row 2 as empty. True
// of the database, wrong for the person deciding where the next box goes.
{
  const racks = [
    { id: 1, rack_id: 'R001-S01-B01', available: 30, capacity: 30 },
    { id: 2, rack_id: 'R001-S01-B02', available: 30, capacity: 30 },
  ];
  const rackById = new Map(racks.map((r) => [r.id, r]));

  // Mirrors the page: pending across every unsaved row, own claim added back.
  const pendingOf = (rows) => {
    const m = new Map();
    for (const row of rows) {
      if (row.saved) continue;
      for (const a of row.allocs) if (a.rackId) m.set(a.rackId, (m.get(a.rackId) || 0) + Number(a.qty || 0));
    }
    return m;
  };
  const freeIn = (rows, rackId, ownQty = 0) => Math.max(
    0,
    Number(rackById.get(rackId).available) - (pendingOf(rows).get(rackId) || 0) + Number(ownQty || 0)
  );

  const rows = [
    { item: 'Black Track', qty: '10', saved: false, allocs: [{ key: 'a', rackId: 1, qty: '10' }] },
    { item: 'Black Track', qty: '10', saved: false, allocs: [{ key: 'b', rackId: null, qty: '' }] },
  ];

  // The reported case, exactly.
  assert.equal(freeIn(rows, 1), 20, 'row 2 must see 20 free, not 30 — row 1 claimed 10');
  assert.equal(freeIn(rows, 2), 30, 'an untouched rack still shows its full space');
  ok('a rack claimed by an earlier row no longer advertises that space to later rows');

  // The box holding the claim still sees its own space as available to it,
  // otherwise editing 10 down to 8 would be impossible.
  assert.equal(freeIn(rows, 1, '10'), 30, "a box may re-use the space it already holds");
  ok('editing an existing quantity is not blocked by its own claim');

  // Filling a rack completely leaves nothing for anyone else.
  const full = [{ item: 'A', qty: '30', saved: false, allocs: [{ key: 'a', rackId: 1, qty: '30' }] }];
  assert.equal(freeIn(full, 1), 0, 'a fully claimed rack shows no space');
  ok('a rack filled by this table reports no space left');

  // Already-saved rows are excluded: their stock is in `available` now, so
  // counting them again would subtract the same units twice.
  const saved = [{ item: 'A', qty: '10', saved: true, allocs: [{ key: 'a', rackId: 1, qty: '10' }] }];
  assert.equal(freeIn(saved, 1), 30, 'a saved row must not be double-counted');
  ok('rows already added are not subtracted twice');

  // Never negative, however over-claimed.
  const over = [{ item: 'A', qty: '99', saved: false, allocs: [{ key: 'a', rackId: 1, qty: '99' }] }];
  assert.equal(freeIn(over, 1), 0, 'free space floors at zero');
  ok('free space never goes negative');
}

console.log('\nlive rack space checks passed\n');
