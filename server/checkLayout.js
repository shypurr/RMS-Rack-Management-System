// Self-check for the rack layout subsystem. No test framework —
// `node checkLayout.js`. The pure sections always run; the DB sections are
// skipped with a notice when MySQL is unreachable.
import assert from 'node:assert/strict';
import {
  configFor, buildTargetBins, assertNoOverlap, diffLayout, findBlockers,
} from './src/services/layoutService.js';

const ok = (label) => console.log(`  ✓ ${label}`);

const BASE = { racks: 300, shelves: 10, bins: 5, bin_capacity: 120 };
const OVERRIDES = [{ id: 1, rack_from: 291, rack_to: 300, shelves: 5, bins: 13, bin_capacity: 80 }];

// ── override resolution ───────────────────────────────────────────────────
assert.deepEqual(configFor(1, BASE, OVERRIDES), { shelves: 10, bins: 5, bin_capacity: 120 });
assert.deepEqual(configFor(290, BASE, OVERRIDES), { shelves: 10, bins: 5, bin_capacity: 120 });
assert.deepEqual(configFor(291, BASE, OVERRIDES), { shelves: 5, bins: 13, bin_capacity: 80 });
assert.deepEqual(configFor(300, BASE, OVERRIDES), { shelves: 5, bins: 13, bin_capacity: 80 });
ok('an override applies to its whole range and nothing outside it');

// A NULL column inherits the base value rather than becoming null.
const partial = [{ id: 2, rack_from: 5, rack_to: 5, shelves: 3, bins: null, bin_capacity: null }];
assert.deepEqual(configFor(5, BASE, partial), { shelves: 3, bins: 5, bin_capacity: 120 });
ok('a NULL override column inherits the base value');

// ── target bin set ────────────────────────────────────────────────────────
const small = buildTargetBins({ racks: 2, shelves: 3, bins: 4, bin_capacity: 100 }, []);
assert.equal(small.length, 2 * 3 * 4, 'racks × shelves × bins');
assert.deepEqual(small[0], { rack_no: 1, shelf_no: 1, bin_no: 1, capacity: 100 });
assert.deepEqual(small.at(-1), { rack_no: 2, shelf_no: 3, bin_no: 4, capacity: 100 });
ok('the base grid generates exactly racks × shelves × bins');

const mixed = buildTargetBins(BASE, OVERRIDES);
assert.equal(mixed.length, 290 * 10 * 5 + 10 * 5 * 13, 'base racks + overridden racks');
assert.equal(mixed.filter((b) => b.rack_no === 295).length, 5 * 13);
assert.equal(mixed.find((b) => b.rack_no === 295).capacity, 80);
assert.equal(mixed.find((b) => b.rack_no === 1).capacity, 120);
ok('overridden racks contribute their own shelf/bin/capacity');

// ── overlap rejection ─────────────────────────────────────────────────────
assert.doesNotThrow(() => assertNoOverlap([
  { rack_from: 1, rack_to: 10 },
  { rack_from: 11, rack_to: 20 },
]));
ok('adjacent ranges are allowed');

for (const bad of [
  [{ rack_from: 1, rack_to: 10 }, { rack_from: 10, rack_to: 20 }],  // shares rack 10
  [{ rack_from: 1, rack_to: 20 }, { rack_from: 5, rack_to: 8 }],    // fully contained
  [{ rack_from: 5, rack_to: 15 }, { rack_from: 1, rack_to: 10 }],   // partial, unsorted
]) {
  assert.throws(() => assertNoOverlap(bad), /overlap/i);
}
ok('overlapping ranges are rejected regardless of order or nesting');

// ── diff ──────────────────────────────────────────────────────────────────
const existing = [
  { id: 1, rack_no: 1, shelf_no: 1, bin_no: 1, capacity: 100, used: 0 },
  { id: 2, rack_no: 1, shelf_no: 1, bin_no: 2, capacity: 100, used: 40 },
  { id: 3, rack_no: 1, shelf_no: 2, bin_no: 1, capacity: 100, used: 0 },
];
const target = [
  { rack_no: 1, shelf_no: 1, bin_no: 1, capacity: 100 },  // keep, unchanged
  { rack_no: 1, shelf_no: 1, bin_no: 2, capacity: 150 },  // keep, capacity up
  { rack_no: 1, shelf_no: 1, bin_no: 3, capacity: 150 },  // add
];

const d = diffLayout(existing, target);
assert.equal(d.add.length, 1);
assert.deepEqual(d.add[0], { rack_no: 1, shelf_no: 1, bin_no: 3, capacity: 150 });
assert.equal(d.keep.length, 2);
assert.equal(d.remove.length, 1);
assert.equal(d.remove[0].id, 3, 'R01-S02-B01 is no longer in the target');
ok('diff classifies bins into add / keep / remove');

// ── blockers ──────────────────────────────────────────────────────────────
assert.deepEqual(
  findBlockers(diffLayout([{ id: 1, rack_no: 1, shelf_no: 1, bin_no: 1, capacity: 100, used: 0 }], [])),
  [],
  'an empty removed bin is not a blocker'
);
ok('removing an empty bin is allowed');

const occupied = findBlockers(diffLayout(
  [{ id: 9, rack_no: 4, shelf_no: 7, bin_no: 2, capacity: 100, used: 60 }],
  []
));
assert.equal(occupied.length, 1);
assert.equal(occupied[0].kind, 'occupied');
assert.equal(occupied[0].id, 9);
ok('removing a bin that holds stock is a blocker');

// Lowering capacity below what is already in the bin would violate
// chk_used_capacity — same class of hazard, reported the same way.
const shrunk = findBlockers(diffLayout(
  [{ id: 7, rack_no: 2, shelf_no: 1, bin_no: 1, capacity: 100, used: 80 }],
  [{ rack_no: 2, shelf_no: 1, bin_no: 1, capacity: 50 }]
));
assert.equal(shrunk.length, 1);
assert.equal(shrunk[0].kind, 'capacity');
assert.equal(shrunk[0].used, 80);
assert.equal(shrunk[0].capacity, 50);
ok('lowering capacity below current stock is a blocker');

// Raising capacity, or lowering it but staying above `used`, is fine.
assert.equal(findBlockers(diffLayout(
  [{ id: 7, rack_no: 2, shelf_no: 1, bin_no: 1, capacity: 100, used: 80 }],
  [{ rack_no: 2, shelf_no: 1, bin_no: 1, capacity: 90 }]
)).length, 0);
ok('lowering capacity but staying above current stock is allowed');

console.log('  -- pure-function checks passed --');

// ── DB-backed checks ──────────────────────────────────────────────────────
const { pool, pingDb, applyAuthSchema } = await import('./src/db.js');
const { getLayout, previewLayout, applyLayout, getOrgWidths } =
  await import('./src/services/layoutService.js');

if (await pingDb()) {
  console.log('  ! MySQL unreachable - skipping the DB-backed layout checks');
} else {
  await applyAuthSchema();
  const VASTRA_ID = 'checklayout-test-org';
  await pool.query('DELETE FROM organization WHERE vastra_org_id = ?', [VASTRA_ID]);
  const [ins] = await pool.query(
    'INSERT INTO organization (vastra_org_id, name) VALUES (?, ?)',
    [VASTRA_ID, 'Check Layout Org']
  );
  const ORG = ins.insertId;

  // A brand-new org is unconfigured and has no racks.
  const fresh = await getLayout(ORG);
  assert.equal(fresh.configured, false);
  assert.equal(fresh.counts.bins, 0);
  ok('a new organization starts unconfigured with zero bins');

  // First apply: 3 racks x 2 shelves x 2 bins = 12 bins.
  const first = await applyLayout(ORG, {
    racks: 3, shelves: 2, bins: 2, bin_capacity: 100, overrides: [], version: 1, userId: 'test',
  });
  assert.equal(first.added, 12);
  assert.equal(first.removed, 0);
  const after = await getLayout(ORG);
  assert.equal(after.configured, true);
  assert.equal(after.counts.bins, 12);
  ok('first apply generates racks x shelves x bins');

  assert.deepEqual(await getOrgWidths(ORG), { rack: 2, shelf: 2, bin: 2 });
  ok('widths derive from the generated bins');

  // Growth re-pads: 3 racks -> 150 racks means R01 becomes R001.
  await applyLayout(ORG, {
    racks: 150, shelves: 2, bins: 2, bin_capacity: 100, overrides: [],
    version: after.version, userId: 'test',
  });
  assert.deepEqual(await getOrgWidths(ORG), { rack: 3, shelf: 2, bin: 2 });
  const [[firstBin]] = await pool.query(
    'SELECT id FROM rack_master WHERE fk_org_id = ? AND rack_no = 1 AND shelf_no = 1 AND bin_no = 1',
    [ORG]
  );
  assert.ok(firstBin, 'rack 1 bin 1 must still exist after growth');
  ok('growing the rack count re-pads labels without recreating bins');

  // Put stock in a bin that the coming shrink would DELETE. Rack 1 / shelf 1 /
  // bin 1 survives a shrink to one shelf, so it would prove nothing.
  const grown = await getLayout(ORG);
  const [[stockBin]] = await pool.query(
    'SELECT id FROM rack_master WHERE fk_org_id = ? AND rack_no = 1 AND shelf_no = 2 AND bin_no = 1',
    [ORG]
  );
  assert.ok(stockBin, 'rack 1 shelf 2 bin 1 should exist at 2 shelves');
  await pool.query(
    'INSERT INTO item_location (fk_org_id, item, color, size, qty, fk_rack_id) VALUES (?,?,?,?,?,?)',
    [ORG, 'Cotton Twill', 'Navy', 'L', 40, stockBin.id]
  );
  await pool.query('UPDATE rack_master SET used = 40, status = ? WHERE id = ?', ['Occupied', stockBin.id]);

  const blocked = await previewLayout(ORG, {
    racks: 150, shelves: 1, bins: 1, bin_capacity: 100, overrides: [],
  });
  assert.ok(blocked.blockers.length > 0, 'shrinking onto an occupied bin must block');
  await assert.rejects(
    applyLayout(ORG, {
      racks: 150, shelves: 1, bins: 1, bin_capacity: 100, overrides: [],
      version: grown.version, userId: 'test',
    }),
    /stock|occupied/i
  );
  assert.equal((await getLayout(ORG)).counts.bins, grown.counts.bins, 'a blocked apply must write nothing');
  ok('a shrink onto an occupied bin is refused and changes nothing');

  await assert.rejects(
    applyLayout(ORG, {
      racks: 150, shelves: 2, bins: 2, bin_capacity: 10, overrides: [],
      version: grown.version, userId: 'test',
    }),
    /capacity/i
  );
  ok('lowering capacity below stock on hand is refused');

  await assert.rejects(
    applyLayout(ORG, {
      racks: 151, shelves: 2, bins: 2, bin_capacity: 100, overrides: [],
      version: 1, userId: 'test',
    }),
    /changed|version/i
  );
  ok('an apply carrying a stale version is rejected');

  // Clear the stock, then the same shrink succeeds.
  await pool.query('DELETE FROM item_location WHERE fk_org_id = ?', [ORG]);
  await pool.query('UPDATE rack_master SET used = 0, status = ? WHERE id = ?', ['Vacant', stockBin.id]);
  const clean = await getLayout(ORG);
  const shrinkResult = await applyLayout(ORG, {
    racks: 150, shelves: 1, bins: 1, bin_capacity: 100, overrides: [],
    version: clean.version, userId: 'test',
  });
  assert.equal(shrinkResult.removed, 450, '150 racks x (2x2 - 1x1) bins removed');
  assert.equal((await getLayout(ORG)).counts.bins, 150);
  ok('once the stock is cleared the same shrink applies');

  // Overrides are pins: the base governs everything outside their range.
  const pinned = await getLayout(ORG);
  await applyLayout(ORG, {
    racks: 10, shelves: 2, bins: 2, bin_capacity: 100,
    overrides: [{ rack_from: 9, rack_to: 10, shelves: 1, bins: 3, bin_capacity: 50 }],
    version: pinned.version, userId: 'test',
  });
  const [[pinnedBin]] = await pool.query(
    'SELECT capacity FROM rack_master WHERE fk_org_id = ? AND rack_no = 9 AND shelf_no = 1 AND bin_no = 3',
    [ORG]
  );
  assert.equal(pinnedBin.capacity, 50, 'the override governs its range');
  const [[baseBin]] = await pool.query(
    'SELECT capacity FROM rack_master WHERE fk_org_id = ? AND rack_no = 1 AND shelf_no = 1 AND bin_no = 1',
    [ORG]
  );
  assert.equal(baseBin.capacity, 100, 'racks outside the override keep the base');
  const [noBin] = await pool.query(
    'SELECT id FROM rack_master WHERE fk_org_id = ? AND rack_no = 9 AND shelf_no = 2',
    [ORG]
  );
  assert.equal(noBin.length, 0, 'the override cut rack 9 down to one shelf');
  ok('overrides pin their range while the base governs everything else');

  await pool.query('DELETE FROM organization WHERE id = ?', [ORG]);
}

await pool.end();
console.log('\nlayout checks passed\n');
