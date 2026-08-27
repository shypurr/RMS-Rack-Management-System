// Self-check for rack code derivation. No test framework — `node checkRackCode.js`.
// Pure functions, no database, so this always runs.
import assert from 'node:assert/strict';
import { widthsFor, rackCode, decorateRacks } from './src/lib/rackCode.js';

const ok = (label) => console.log(`  ✓ ${label}`);

// Width = digit count of the maximum, floored at 2 so small shelf/bin counts
// keep the S01/B01 look the UI has always had.
assert.deepEqual(widthsFor({ maxRack: 10, maxShelf: 4, maxBin: 5 }), { rack: 2, shelf: 2, bin: 2 });
assert.deepEqual(widthsFor({ maxRack: 300, maxShelf: 10, maxBin: 13 }), { rack: 3, shelf: 2, bin: 2 });
assert.deepEqual(widthsFor({ maxRack: 1000, maxShelf: 10, maxBin: 5 }), { rack: 4, shelf: 2, bin: 2 });
ok('width is the digit count of the max, minimum 2');

// A zero/empty org must not produce NaN widths.
assert.deepEqual(widthsFor({ maxRack: 0, maxShelf: 0, maxBin: 0 }), { rack: 2, shelf: 2, bin: 2 });
ok('an empty org falls back to width 2, not NaN');

const bin = { rack_no: 1, shelf_no: 2, bin_no: 3 };
assert.equal(rackCode(bin, widthsFor({ maxRack: 10, maxShelf: 4, maxBin: 5 })), 'R01-S02-B03');
assert.equal(rackCode(bin, widthsFor({ maxRack: 300, maxShelf: 10, maxBin: 13 })), 'R001-S02-B03');
assert.equal(rackCode(bin, widthsFor({ maxRack: 1000, maxShelf: 10, maxBin: 5 })), 'R0001-S02-B03');
ok('the same bin re-pads as the org grows, identity untouched');

// The growth case called out explicitly in the design: 300 → 1000 racks.
const at300 = widthsFor({ maxRack: 300, maxShelf: 10, maxBin: 5 });
const at1000 = widthsFor({ maxRack: 1000, maxShelf: 10, maxBin: 5 });
assert.equal(rackCode({ rack_no: 7, shelf_no: 1, bin_no: 1 }, at300), 'R007-S01-B01');
assert.equal(rackCode({ rack_no: 7, shelf_no: 1, bin_no: 1 }, at1000), 'R0007-S01-B01');
ok('growing 300 → 1000 re-pads an existing rack from R007 to R0007');

const rows = decorateRacks(
  [{ id: 5, rack_no: 2, shelf_no: 1, bin_no: 4, capacity: 100 }],
  widthsFor({ maxRack: 30, maxShelf: 3, maxBin: 5 })
);
assert.equal(rows[0].rack_id, 'R02-S01-B04');
assert.equal(rows[0].id, 5, 'decorate must not disturb the numeric identity');
assert.equal(rows[0].capacity, 100, 'decorate must preserve other columns');
ok('decorateRacks adds rack_id without touching id or other columns');

console.log('\nrack code checks passed\n');
