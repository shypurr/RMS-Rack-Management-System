// Rack display codes are DERIVED, never stored. rack_master holds
// (rack_no, shelf_no, bin_no) as integers; the padded code the user sees is
// rendered from those plus the org's current maximums.
//
// This is what makes dynamic pad width safe. An org growing from 300 to 1000
// racks re-pads every label (R007 → R0007) without renaming a row, moving a
// foreign key, or invalidating audit history — because no row ever stored
// "R007" in the first place.

// Minimum 2 keeps the S01/B01 look the UI has always had for small shelf and
// bin counts; every rack count the design calls out (10, 300, 1000) is >= 2
// digits anyway, so the floor never contradicts the stated rule.
const MIN_WIDTH = 2;

const widthOf = (max) => Math.max(MIN_WIDTH, String(Math.max(1, Number(max) || 0)).length);

export function widthsFor({ maxRack, maxShelf, maxBin }) {
  return { rack: widthOf(maxRack), shelf: widthOf(maxShelf), bin: widthOf(maxBin) };
}

const pad = (n, w) => String(n).padStart(w, '0');

export function rackCode({ rack_no, shelf_no, bin_no }, widths) {
  return `R${pad(rack_no, widths.rack)}-S${pad(shelf_no, widths.shelf)}-B${pad(bin_no, widths.bin)}`;
}

// `rack_id` deliberately keeps its old name and meaning — the human-readable
// code — so every rendering site in the client (RackCard, History, the PDF)
// works unchanged. What changed is that it is now computed, not a primary key.
export const decorateRack = (row, widths) => ({ ...row, rack_id: rackCode(row, widths) });

export const decorateRacks = (rows, widths) => rows.map((r) => decorateRack(r, widths));
