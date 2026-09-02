// Self-check for the inward generator. `node server/inwardFixtures.check.mjs`
import assert from 'node:assert/strict';
import { buildInwards, CATALOG, INWARD_MODULES, MODULE_PREFIX } from './inwardFixtures.js';
const ok = (l) => console.log(`  ✓ ${l}`);

const docNo = (id) => String(id).split('#')[0];
const group = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(docNo(r[0]), (m.get(docNo(r[0])) || 0) + 1);
  return m;
};

// The property that matters: a real inward is never a single item.
let docsSeen = 0, linesSeen = 0, maxLines = 0;
for (let trial = 0; trial < 200; trial++) {
  const rows = buildInwards(CATALOG, { count: 3 });
  const byDoc = group(rows);
  assert.equal(byDoc.size, 3 * INWARD_MODULES.length, 'count is per module');
  for (const [id, n] of byDoc) {
    assert.ok(n >= 2, `${id} came out with ${n} line(s) — inwards are never single-item`);
    docsSeen++; linesSeen += n; maxLines = Math.max(maxLines, n);
  }
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length, 'line ids unique (primary key)');
}
ok(`200 runs: every one of ${docsSeen} documents is multi-line (avg ${(linesSeen/docsSeen).toFixed(1)}, max ${maxLines})`);

// Hostile catalogue: if every design has one size, the top-up loop is the only
// thing keeping documents plural.
const singleSize = [
  { item: 'Banarasi Saree', colors: ['Maroon', 'Gold'], sizes: ['Free Size'] },
  { item: 'Silk Stole',     colors: ['Rust'],           sizes: ['Free Size'] },
];
for (let trial = 0; trial < 200; trial++) {
  for (const [, n] of group(buildInwards(singleSize, { count: 2 }))) {
    assert.ok(n >= 2, `single-size catalogue produced a ${n}-line document`);
  }
}
ok('holds even when every design in the catalogue has exactly one size');

// Shape of what goes into the table.
const rows = buildInwards(CATALOG, { count: 2 });
const prefixes = new Set(Object.values(MODULE_PREFIX));
for (const [id, mod, item, color, size, qty] of rows) {
  assert.ok(/^[A-Z]{2}-2026-\d{4}#\d+$/.test(id), `bad id ${id}`);
  assert.ok(prefixes.has(id.slice(0, 2)), `unknown prefix in ${id}`);
  assert.ok(INWARD_MODULES.includes(mod), `${mod} is not an inbound module`);
  assert.ok(item && size, 'item and size are always present');
  assert.ok(typeof color === 'string', 'colour is a string');
  assert.ok(Number.isInteger(qty) && qty >= 15 && qty <= 90, `qty ${qty} out of range`);
}
ok('rows carry a valid id, an inbound module, and a quantity in 15–90');

// A document's id must be stable across its lines, and its lines numbered 1..n.
for (const [doc, n] of group(rows)) {
  const lines = rows.filter((r) => docNo(r[0]) === doc).map((r) => Number(r[0].split('#')[1]));
  assert.deepEqual(lines.sort((a, z) => a - z), Array.from({ length: n }, (_, i) => i + 1),
    `${doc} lines are not numbered 1..${n}`);
}
ok('each document numbers its lines 1..n with no gaps');

// Splitting across bins has to be exercisable: some lines must exceed 30.
const big = buildInwards(CATALOG, { count: 5 }).filter((r) => r[5] > 30).length;
assert.ok(big > 0, 'no line exceeds a 30-capacity bin — rack splitting would never be seen');
ok(`${big} lines exceed a 30-capacity bin, so rack splitting is exercisable`);

// startAt keeps makeInwards clear of the seed's numbering.
const later = buildInwards(CATALOG, { count: 2, startAt: 9001 });
assert.ok([...group(later).keys()].every((d) => /-9\d{3}$/.test(d)), 'startAt not honoured');
assert.ok([...group(later).keys()].every((d) => /-2026-9[0-9]{3}$/.test(d)),
  'generated ids must match the --replace pattern in makeInwards.js');
ok('startAt: 9001 yields ids --replace can find, clear of the seed range');

console.log('\ninward fixture checks passed\n');
