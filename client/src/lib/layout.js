import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

// Whether this organization has any bins yet. Everything that stores or moves
// stock is meaningless before that, so those pages render a pointer to /setup
// instead of an empty rack list. The server enforces the same rule
// independently — this is the friendly half, not the actual gate.
export function useLayoutStatus() {
  const [state, setState] = useState({ loading: true, configured: false, counts: null });
  useEffect(() => {
    let alive = true;
    api.layout()
      .then((d) => alive && setState({ loading: false, configured: d.configured, counts: d.counts }))
      .catch(() => alive && setState({ loading: false, configured: false, counts: null }));
    return () => { alive = false; };
  }, []);
  return state;
}

// What one batch of racks would produce. Shown live under the form so the size
// of the thing is on screen BEFORE the user presses Done — which is the whole
// safety story now that adding is immediate and there is no preview step.
//
// A batch is uniform (every rack the same shape), so unlike the old base-plus-
// overrides model these are a plain multiplication rather than a walk.
export function countBins({ racks, shelves, bins }) {
  return (Number(racks) || 0) * (Number(shelves) || 0) * (Number(bins) || 0);
}

export function countCapacity({ racks, shelves, bins, bin_capacity }) {
  return countBins({ racks, shelves, bins }) * (Number(bin_capacity) || 0);
}

// Where this batch's racks will land. Racks are only ever appended, so the next
// one is the highest that exists plus one — never a count of them: once the
// remove-racks flow can leave a gap in the numbering the two stop agreeing, and
// the server computes this from MAX(rack_no) for exactly that reason.
export function highestRackNo(groups = []) {
  return groups.reduce((max, g) => Math.max(max, Number(g.rack_to) || 0), 0);
}

export function nextRackRange(groups, racks) {
  const n = Number(racks) || 0;
  if (n <= 0) return null;
  const from = highestRackNo(groups) + 1;
  return { from, to: from + n - 1 };
}

// Adjacent ranges join up: R1–R50 followed by R51–R60 is one unbroken R1–R60,
// not two things that happen to touch.
function coalesce(ranges) {
  const out = [];
  for (const r of [...ranges].sort((a, z) => a.from - z.from)) {
    const last = out[out.length - 1];
    if (last && r.from === last.to + 1) last.to = r.to;
    else out.push({ ...r });
  }
  return out;
}

// Batches of the same SHAPE are the same kind of rack, so the table shows them
// as one line. Adding ten racks exactly like the first fifty should read as
// "60 racks", not leave the user adding up two rows to find out how many racks
// of that kind they own. Change any one of shelves, bins or capacity and it is a
// different kind of rack, which stays its own row.
//
// Display only. The stored batches are untouched, so the record of what was
// added when survives, and rack numbering is unaffected.
export function mergeGroups(groups = []) {
  const m = new Map();
  for (const g of groups) {
    const key = `${g.shelves}|${g.bins}|${g.bin_capacity}`;
    const row = m.get(key) || {
      key,
      shelves: g.shelves,
      bins: g.bins,
      bin_capacity: g.bin_capacity,
      rack_count: 0,
      bin_count: 0,
      capacity: 0,
      ranges: [],
      batches: 0,
      // The batch that introduced this shape, so a later merge does not
      // reshuffle the table.
      seq: Number(g.seq) || 0,
    };
    row.rack_count += Number(g.rack_count) || 0;
    row.bin_count += Number(g.bin_count) || 0;
    row.capacity += Number(g.capacity) || 0;
    row.ranges.push({ from: Number(g.rack_from), to: Number(g.rack_to) });
    row.batches += 1;
    row.seq = Math.min(row.seq, Number(g.seq) || 0);
    m.set(key, row);
  }
  return [...m.values()]
    .sort((a, z) => a.seq - z.seq)
    .map((row) => ({ ...row, ranges: coalesce(row.ranges) }));
}

// "R1–R50, R71–R80". A single rack is just "R7", not "R7–R7".
export const rangeLabel = (ranges = []) =>
  ranges.map((r) => (r.from === r.to ? `R${r.from}` : `R${r.from}–R${r.to}`)).join(', ');
