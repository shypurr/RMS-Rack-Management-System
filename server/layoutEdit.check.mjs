// Self-check for editing one rack. `node server/layoutEdit.check.mjs`
//
// Two things here can go wrong quietly, which is why they are tested rather
// than read:
//
//   1. The GROUP SPLIT. Rack groups describe batches, and a batch carries one
//      shape — so reshaping R7 inside R1–R100 has to break that batch into
//      three pieces. Get an off-by-one wrong and Rack Setup describes a
//      warehouse that is not the one on the floor: a rack listed twice, or one
//      that vanishes from the list while its bins sit there holding stock.
//
//   2. The BIN DIFF. Making a rack smaller deletes bins. This is the only path
//      in the app that deletes a bin at all, so "which bins" has to be exactly
//      right, and the refusal has to fire on anything with stock in it.
import assert from 'node:assert/strict';
import {
  splitGroupAround, binsForGroup, diffLayout, findBlockers,
} from './src/services/layoutService.js';

const ok = (l) => console.log(`  ✓ ${l}`);
const NEW = { shelves: 3, bins: 4, bin_capacity: 50 };
const batch = (from, to) => ({
  id: 1, rack_from: from, rack_to: to, shelves: 7, bins: 21, bin_capacity: 30,
});

// ── the split ─────────────────────────────────────────────────────────────

{
  const pieces = splitGroupAround(batch(1, 100), 1, NEW);
  assert.deepEqual(pieces.map((p) => [p.rack_from, p.rack_to]), [[1, 1], [2, 100]]);
  assert.equal(pieces[0].shelves, 3, 'the edited rack takes the new shape');
  assert.equal(pieces[1].shelves, 7, 'the rest of the batch keeps the old one');
  ok('editing the first rack of a batch leaves the other 99 untouched');
}

{
  const pieces = splitGroupAround(batch(1, 100), 100, NEW);
  assert.deepEqual(pieces.map((p) => [p.rack_from, p.rack_to]), [[1, 99], [100, 100]]);
  assert.equal(pieces[1].bin_capacity, 50);
  ok('editing the last rack of a batch splits it in two, not three');
}

{
  const pieces = splitGroupAround(batch(1, 100), 7, NEW);
  assert.deepEqual(pieces.map((p) => [p.rack_from, p.rack_to]), [[1, 6], [7, 7], [8, 100]]);
  assert.equal(pieces[1].bins, 4, 'only the edited rack changes shape');
  assert.equal(pieces[0].bins, 21);
  assert.equal(pieces[2].bins, 21);
  ok('editing a rack in the middle splits its batch around it');
}

{
  const pieces = splitGroupAround(batch(7, 7), 7, NEW);
  assert.equal(pieces.length, 1, 'a batch of one stays a batch of one');
  assert.deepEqual([pieces[0].rack_from, pieces[0].rack_to], [7, 7]);
  assert.equal(pieces[0].shelves, 3);
  ok('editing a rack that is already its own batch adds no rows');
}

{
  // A warehouse built before rack_group existed has bins but no batch row.
  const pieces = splitGroupAround(undefined, 12, NEW);
  assert.deepEqual(pieces, [{ rack_from: 12, rack_to: 12, ...NEW }]);
  ok('a rack with no batch row still ends up described by one');
}

// The property that matters: whatever the split does, the pieces must still
// describe exactly the racks the original batch described — every one of them,
// once each, in order. A gap here is a rack that Rack Setup stops listing while
// its bins keep holding stock.
{
  let checked = 0;
  for (let from = 1; from <= 12; from++) {
    for (let to = from; to <= from + 12; to++) {
      for (let target = from; target <= to; target++) {
        const pieces = splitGroupAround(batch(from, to), target, NEW);

        const covered = [];
        for (const p of pieces) {
          assert.ok(p.rack_to >= p.rack_from, `piece ${p.rack_from}-${p.rack_to} runs backwards`);
          for (let r = p.rack_from; r <= p.rack_to; r++) covered.push(r);
        }
        const expected = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        assert.deepEqual(covered, expected,
          `splitting R${from}-R${to} at R${target} lost or duplicated a rack`);

        // Exactly one piece describes the edited rack, and it is the new shape.
        const owner = pieces.filter((p) => p.rack_from <= target && p.rack_to >= target);
        assert.equal(owner.length, 1);
        assert.deepEqual(
          { shelves: owner[0].shelves, bins: owner[0].bins, bin_capacity: owner[0].bin_capacity },
          NEW
        );
        // And no OTHER rack quietly changed shape.
        for (const p of pieces) {
          if (p === owner[0]) continue;
          assert.equal(p.shelves, 7);
          assert.equal(p.bins, 21);
          assert.equal(p.bin_capacity, 30);
        }
        checked++;
      }
    }
  }
  ok(`${checked} splits: every rack still described exactly once, and only the edited one reshaped`);
}

// ── the bin diff ──────────────────────────────────────────────────────────

// The bins a rack has now, as rack_master rows look coming out of the database.
const binsOf = (shelves, bins, capacity, used = () => 0) => {
  const out = [];
  let id = 1;
  for (let s = 1; s <= shelves; s++) {
    for (let b = 1; b <= bins; b++) {
      out.push({ id: id++, rack_no: 5, shelf_no: s, bin_no: b, capacity, used: used(s, b) });
    }
  }
  return out;
};
const target = (shelves, bins, bin_capacity) =>
  binsForGroup({ rack_from: 5, rack_to: 5, shelves, bins, bin_capacity });

{
  const existing = binsOf(7, 21, 30);            // 147 bins
  const { add, keep, remove } = diffLayout(existing, target(3, 10, 30)); // 30 bins
  assert.equal(add.length, 0, 'shrinking adds nothing');
  assert.equal(keep.length, 30);
  assert.equal(remove.length, 117);
  // The survivors are precisely shelves 1-3, bins 1-10 — not the first 30 rows.
  assert.ok(keep.every((b) => b.shelf_no <= 3 && b.bin_no <= 10));
  assert.ok(remove.every((b) => b.shelf_no > 3 || b.bin_no > 10));
  ok('shrinking a rack removes exactly the bins that stop existing');
}

{
  const existing = binsOf(3, 10, 30);
  const { add, keep, remove } = diffLayout(existing, target(5, 10, 30));
  assert.equal(remove.length, 0, 'growing removes nothing');
  assert.equal(keep.length, 30);
  assert.equal(add.length, 20);
  assert.ok(add.every((b) => b.shelf_no > 3), 'the new bins are the new shelves');
  ok('growing a rack keeps every bin it already had');
}

{
  const existing = binsOf(3, 10, 30);
  const { add, keep, remove } = diffLayout(existing, target(3, 10, 90));
  assert.equal(add.length, 0);
  assert.equal(remove.length, 0);
  assert.equal(keep.length, 30);
  assert.ok(keep.every((b) => b.newCapacity === 90), 'every survivor takes the new capacity');
  ok('changing only the capacity adds and removes no bins at all');
}

// The refusals. These are what stand between a mistyped number and stock that
// exists on a shelf but nowhere in the database.
{
  const existing = binsOf(7, 21, 30, (s) => (s === 7 ? 4 : 0)); // stock on the last shelf
  const { keep, remove } = diffLayout(existing, target(3, 10, 30));
  const blockers = findBlockers({ keep, remove });
  assert.ok(blockers.length > 0, 'deleting a bin with stock in it must be refused');
  assert.ok(blockers.every((b) => b.kind === 'occupied'));
  ok('a rack is refused when the bins being removed still hold stock');
}

{
  const existing = binsOf(3, 10, 30, () => 25);  // every bin holds 25
  const { keep, remove } = diffLayout(existing, target(3, 10, 10));
  const blockers = findBlockers({ keep, remove });
  assert.ok(blockers.length > 0, 'a bin cannot be shrunk below what is in it');
  assert.ok(blockers.every((b) => b.kind === 'capacity'));
  ok('a rack is refused when a surviving bin would be smaller than its contents');
}

{
  const existing = binsOf(7, 21, 30);            // completely empty
  const { keep, remove } = diffLayout(existing, target(1, 1, 1));
  assert.deepEqual(findBlockers({ keep, remove }), [],
    'an empty rack has nothing to protect — every shape is allowed');
  ok('an empty rack can be reshaped to anything, however drastic');
}

console.log('\nrack edit checks passed\n');
