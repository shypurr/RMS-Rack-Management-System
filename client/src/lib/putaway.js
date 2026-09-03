// The arithmetic behind a Putaway line: how much of it has a rack, how much
// still needs one, and what happens to the racks already chosen when the
// counted quantity changes.
//
// It lives here rather than inside the page because one rule in it is a
// correctness rule, not a display one: a line must never put away more than it
// says it has. Editing the quantity DOWN after choosing racks is the way to
// break that, and a bug there means stock appearing in a rack that nobody ever
// received — invisible on screen, wrong in the database.

export const num = (v) => Number(v) || 0;

// Total already spread across racks for one line.
export const allocatedOn = (row) => row.allocs.reduce((s, a) => s + num(a.qty), 0);

// How much of the line still has nowhere to go.
export const remainingOn = (row) => Math.max(0, num(row.qty) - allocatedOn(row));

// The ceiling for one rack's quantity box: everything unallocated, plus
// whatever that box already holds. This is what stops the boxes summing past
// the line — "when all 90 are placed you cannot add another rack".
export const allocCeiling = (row, alloc) =>
  Math.max(0, num(row.qty) - allocatedOn(row) + num(alloc.qty));

// Set a line's quantity, trimming rack allocations that no longer fit.
//
// Trimming runs from the LAST rack backwards: the most recently added is the
// one the user is least attached to, and taking from the first would silently
// empty the rack they chose most deliberately. An emptied box becomes '' rather
// than '0' so it reads as "not filled in yet", which is what it now is.
export function withQty(row, raw) {
  const qty = raw === '' ? '' : String(Math.max(0, Math.floor(Number(raw)) || 0));

  let over = allocatedOn(row) - num(qty);
  if (over <= 0) return { ...row, qty, saved: false, error: null };

  const allocs = [...row.allocs];
  for (let i = allocs.length - 1; i >= 0 && over > 0; i--) {
    const have = num(allocs[i].qty);
    const take = Math.min(have, over);
    allocs[i] = { ...allocs[i], qty: have - take > 0 ? String(have - take) : '' };
    over -= take;
  }
  return { ...row, qty, allocs, saved: false, error: null };
}

// ── suggesting racks ───────────────────────────────────────────────────────
// Placing a big inward by hand is the job this exists to remove: one document
// in the test data is 536 units against 10-unit bins, which is 54 rack pickers
// to operate by hand. The suggestion is a starting point, never a decision —
// every box it fills stays editable.

let allocSeq = 0;
export const newAllocKey = () => `sa-${++allocSeq}`;

export const stockKey = (item, color, size) =>
  `${String(item ?? '').trim()}|${String(color ?? '').trim()}|${String(size ?? '').trim()}`;

// Which racks already hold each exact product, from the stock list the page
// already loads. This is what makes "same item first" possible, and it restores
// the consolidation hint the old single-item Putaway had.
export function indexPlacements(items = []) {
  const m = new Map();
  for (const it of items) {
    const k = stockKey(it.item, it.color, it.size);
    const set = m.get(k) || new Set();
    set.add(it.fk_rack_id);
    m.set(k, set);
  }
  return m;
}

// Fill in racks for every line that still needs them.
//
// Two rules, in order:
//   1. Top up racks that ALREADY hold this exact item/colour/size, so one
//      product stays in one place instead of scattering a little further with
//      every delivery.
//   2. Then the emptiest racks, so what does scatter lands where there is room.
//
// The `free` ledger is the part that has to be right. Every line draws from one
// shared picture of remaining space — including space already claimed by hand,
// and by lines suggested earlier in the same pass. Without it each line would
// be told the same empty bin has room for all of it, the screen would look
// finished, and the server would reject half the adds at save time.
//
// Anything the user already chose is left alone; only the unplaced remainder is
// filled. Pressing the button twice is therefore safe.
export function suggestRacks(rows, racks, placements = new Map()) {
  const free = new Map(racks.map((r) => [r.id, Math.max(0, num(r.available))]));
  for (const row of rows) {
    for (const a of row.allocs) {
      if (a.rackId && free.has(a.rackId)) {
        free.set(a.rackId, free.get(a.rackId) - num(a.qty));
      }
    }
  }

  return rows.map((row) => {
    if (row.saved || !String(row.item ?? '').trim()) return row;
    let remaining = remainingOn(row);
    if (remaining <= 0) return row;

    // A rack this line already targets is skipped: a second box pointing at the
    // same bin reads as a mistake even though it would add up correctly.
    const taken = new Set(row.allocs.filter((a) => a.rackId).map((a) => a.rackId));
    const holding = placements.get(stockKey(row.item, row.color, row.size)) || new Set();

    const roomiestFirst = (a, b) => (free.get(b.id) || 0) - (free.get(a.id) || 0) || a.id - b.id;
    const pool = racks.filter((r) => (free.get(r.id) || 0) > 0 && !taken.has(r.id));
    const ordered = [
      ...pool.filter((r) => holding.has(r.id)).sort(roomiestFirst),
      ...pool.filter((r) => !holding.has(r.id)).sort(roomiestFirst),
    ];

    const additions = [];
    for (const r of ordered) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, free.get(r.id));
      if (take <= 0) continue;
      free.set(r.id, free.get(r.id) - take);
      remaining -= take;
      additions.push({ rackId: r.id, qty: String(take), consolidated: holding.has(r.id) });
    }
    if (!additions.length) return row;

    // Reuse blank rack boxes before appending new ones, so the button does not
    // leave a trail of empty pickers behind the ones it filled.
    const allocs = [...row.allocs];
    let next = 0;
    for (let i = 0; i < allocs.length && next < additions.length; i++) {
      if (!allocs[i].rackId && !num(allocs[i].qty)) allocs[i] = { ...allocs[i], ...additions[next++] };
    }
    while (next < additions.length) allocs.push({ key: newAllocKey(), ...additions[next++] });

    return { ...row, allocs, saved: false, error: null };
  });
}
