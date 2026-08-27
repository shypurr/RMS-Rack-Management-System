// Sample delivery challans for the Picklist tab, shaped like a real Vastra DC.
//
// The thing that matters here is the SIZE RUN. A real challan lists one design
// once and then spreads its quantity across a row of sizes:
//
//   Sr  Item          Color      36  38  42  44  46  L   Total
//   1   DES-5044 …    No Color   1   2   3   1   1   1   9
//
// which reaches RMS as one line per size (same item, same colour, different
// size, its own quantity). So a challan is generated as a few DESIGN BLOCKS,
// each block being one (item, colour) fanned out over several of its sizes.
//
// Challans are built FROM stock that actually exists, so a generated picklist
// resolves to real racks instead of showing every line as short.
//
// Used by seed.js (full rebuild) and makeChallans.js (add to a live database).

export const PICK_MODULE = 'Delivery Challan';
export const PICK_PREFIX = 'DC';

// Column order of every row this module returns.
export const CHALLAN_COLUMNS = '(fk_org_id, id, module_type, item, color, size, qty, party, doc_date)';

const PARTIES = [
  'Keshav Textiles', 'Janki Fashion House', 'Manoj Traders', 'Ramesh Exports',
  'Shree Creations', 'Anita Garments', 'Vikram Wholesale', 'Priya Boutique',
];

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const rndInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const chance = (p) => Math.random() < p;
const pad = (n, w = 2) => String(n).padStart(w, '0');

const daysAgo = (d) => {
  const t = new Date(Date.now() - d * 86400000);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

// Group stock into (item, colour) → the sizes it exists in, so a design block
// can only ask for sizes the warehouse actually stocks.
function indexByDesign(stock) {
  const byDesign = new Map();
  for (const s of stock) {
    const key = `${s.item}|${s.color}`;
    const sizes = byDesign.get(key) || [];
    const existing = sizes.find((x) => x.size === s.size);
    if (existing) existing.qty += Number(s.qty) || 0;
    else sizes.push({ size: s.size, qty: Number(s.qty) || 0 });
    byDesign.set(key, sizes);
  }
  // Multi-size designs first: those are what make the size-run case testable.
  return [...byDesign.entries()]
    .map(([key, sizes]) => {
      const [item, color] = key.split('|');
      return { item, color, sizes };
    })
    .sort((a, b) => b.sizes.length - a.sizes.length);
}

// `startAt` continues the numbering when adding challans to a database that
// already has some.
export function buildChallans(stock, { count = 14, startAt = 1 } = {}) {
  const designs = indexByDesign(stock);
  if (!designs.length) return [];

  // Prefer real size runs; fall back to whatever exists if stock is thin.
  const multiSize = designs.filter((d) => d.sizes.length > 1);
  const rows = [];

  for (let n = 0; n < count; n++) {
    const id = `${PICK_PREFIX}-2026-${pad(startAt + n, 4)}`;
    const party = rnd(PARTIES);
    const date = daysAgo(rndInt(0, 30));
    const usedDesigns = new Set();
    let line = 0;

    // 1–3 designs per challan, like the screenshot's Sr column.
    for (let block = 0; block < rndInt(1, 3); block++) {
      // Two out of three blocks are a genuine size run when one is available.
      const pool = multiSize.length && chance(0.66) ? multiSize : designs;
      const design = rnd(pool);
      const designKey = `${design.item}|${design.color}`;
      if (usedDesigns.has(designKey)) continue;
      usedDesigns.add(designKey);

      // Take a run of sizes from this design — the whole run when it is short,
      // a slice when the design has many.
      const runLength = Math.min(design.sizes.length, rndInt(2, 6));
      const run = [...design.sizes].sort(() => Math.random() - 0.5).slice(0, runLength);

      for (const s of run) {
        // Garment challans move small per-size quantities (the sample DC is
        // 1/2/3/1/1/1). ~12% of lines over-ask on purpose so the shortage
        // badge has something to render.
        const qty = chance(0.12)
          ? s.qty + rndInt(3, 20)
          : Math.max(1, Math.min(s.qty, rndInt(1, 4)));
        rows.push([`${id}#${++line}`, PICK_MODULE, design.item, design.color, s.size, qty, party, date]);
      }
    }
  }
  return rows;
}
