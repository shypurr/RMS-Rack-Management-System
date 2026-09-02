// Sample INBOUND documents (Purchase Inward, Job Slip, Pack Design, Sales
// Return) for the Putaway tab, shaped like a real Vastra inward.
//
// The thing that matters here is that a document carries MANY LINES. A real
// purchase inward is not one item — it is a delivery, and a delivery is a
// design across a run of sizes, usually several designs:
//
//   Sr  Item             Color    Size   Qty
//   1   Anarkali Kurti   Teal     S      24
//   2   Anarkali Kurti   Teal     M      60
//   3   Anarkali Kurti   Teal     L      45
//   4   Formal Shirt     White    40     30
//
// which reaches RMS as one row per line. This module generates that, so the
// Putaway screen — which fills its whole table from one document — has
// something real to open.
//
// It replaced a generator that emitted one line per document. That was never
// what an inward looks like, and it made a multi-item Putaway impossible to
// see working: every document opened as a single row.
//
// Used by seed.js (full rebuild) and makeInwards.js (add to a live database),
// the same way challanFixtures.js is shared by seed.js and makeChallans.js.

// Inbound only. These also stamp item_location.module_type, whose ENUM has no
// Delivery Challan — a challan removes stock, it is never its provenance.
export const INWARD_MODULES = ['Purchase Inward', 'Job Slip', 'Pack Design', 'Sales Return'];

export const MODULE_PREFIX = {
  'Purchase Inward': 'PI',
  'Job Slip': 'JS',
  'Pack Design': 'PD',
  'Sales Return': 'SR',
};

// Column order of every row this module returns.
export const INWARD_COLUMNS = '(fk_org_id, id, module_type, item, color, size, qty)';

// The product catalogue the whole stub is built from. It lives here rather than
// in seed.js so makeInwards.js cannot drift into describing a different
// warehouse than the seed does.
export const CATALOG = [
  { item: 'Banarasi Saree',   colors: ['Maroon', 'Red', 'Gold', 'Emerald', 'Navy'],       sizes: ['Free Size'] },
  { item: 'Cotton Saree',     colors: ['White', 'Beige', 'Sky Blue', 'Mustard'],          sizes: ['Free Size'] },
  { item: 'Anarkali Kurti',   colors: ['Red', 'Black', 'Teal', 'Peach', 'Olive'],         sizes: ['S', 'M', 'L', 'XL', 'XXL'] },
  { item: 'Rayon Kurti',      colors: ['Blue', 'Green', 'Pink', 'Grey'],                  sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Salwar Kameez',    colors: ['Cream', 'Maroon', 'Navy', 'Lavender'],            sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Bridal Lehenga',   colors: ['Red', 'Magenta', 'Gold', 'Wine'],                 sizes: ['S', 'M', 'L'] },
  { item: 'Chiffon Dupatta',  colors: ['White', 'Yellow', 'Turquoise', 'Rose'],           sizes: ['Free Size'] },
  { item: 'Formal Shirt',     colors: ['White', 'Sky Blue', 'Black', 'Lilac'],            sizes: ['38', '40', '42', '44'] },
  { item: 'Casual Shirt',     colors: ['Denim', 'Olive', 'Checked Red', 'Grey'],          sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Formal Trousers',  colors: ['Black', 'Navy', 'Charcoal', 'Beige'],             sizes: ['30', '32', '34', '36', '38'] },
  { item: 'Palazzo Pants',    colors: ['Black', 'White', 'Mustard', 'Maroon'],            sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Kids Frock',       colors: ['Pink', 'Yellow', 'Sky Blue', 'Mint'],             sizes: ['2-3Y', '4-5Y', '6-7Y', '8-9Y'] },
  { item: 'Kids Kurta Set',   colors: ['White', 'Orange', 'Green'],                       sizes: ['2-3Y', '4-5Y', '6-7Y'] },
  { item: 'Nehru Jacket',     colors: ['Black', 'Beige', 'Maroon', 'Bottle Green'],       sizes: ['38', '40', '42', '44'] },
  { item: 'Silk Stole',       colors: ['Gold', 'Silver', 'Rust', 'Indigo'],               sizes: ['Free Size'] },
  { item: 'Nightwear Set',    colors: ['Pink', 'Grey', 'Navy', 'Printed'],                sizes: ['S', 'M', 'L', 'XL'] },
];

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const rndInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pad = (n, w = 4) => String(n).padStart(w, '0');

// A design block: one (item, colour) fanned out over a run of its sizes, which
// is how a delivery of that design actually arrives. A design stocked in one
// size ("Free Size") contributes a single line, which is why the caller below
// tops documents up rather than trusting a block to be plural.
function designBlock(catalog, used) {
  const c = rnd(catalog);
  const color = rnd(c.colors);
  const sizes = c.sizes.length > 1
    ? c.sizes.slice(0, rndInt(2, c.sizes.length))
    : c.sizes;

  const lines = [];
  for (const size of sizes) {
    const key = `${c.item}|${color}|${size}`;
    if (used.has(key)) continue;   // id is the primary key; no repeated lines
    used.add(key);
    // Deliberately spans past a typical bin capacity: a 90-piece line cannot
    // fit one 30-capacity bin, which is the case Putaway's rack-splitting
    // exists for and the only way to see it working.
    lines.push({ item: c.item, color, size, qty: rndInt(15, 90) });
  }
  return lines;
}

// `startAt` continues the numbering when adding inwards to a database that
// already has some. `count` is documents PER MODULE.
//
// Returns rows in INWARD_COLUMNS order (minus fk_org_id, which the caller
// prepends), with ids like "PI-2026-0007#3": source_transaction.id is the
// primary key, so a document's lines are distinguished by the "#n" suffix and
// everything reading these splits on it to recover the document number. Live
// Vastra needs no such trick — there one masterNo simply repeats.
export function buildInwards(catalog = CATALOG, { count = 18, startAt = 1, modules = INWARD_MODULES } = {}) {
  const rows = [];

  for (const mod of modules) {
    for (let n = 0; n < count; n++) {
      const docId = `${MODULE_PREFIX[mod]}-2026-${pad(startAt + n)}`;
      const used = new Set();
      const lines = [];

      for (let b = 0; b < rndInt(1, 3); b++) lines.push(...designBlock(catalog, used));

      // Guaranteed, not hoped for. A one-line document is exactly what this
      // module exists to stop producing, and a single-size design yields one
      // line — so without this a run can emit documents that prove nothing.
      for (let guard = 0; lines.length < 2 && guard < 20; guard++) {
        lines.push(...designBlock(catalog, used));
      }

      lines.forEach((l, i) => {
        rows.push([`${docId}#${i + 1}`, mod, l.item, l.color, l.size, l.qty]);
      });
    }
  }
  return rows;
}
