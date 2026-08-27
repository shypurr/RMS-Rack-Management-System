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

// Total bins a base grid plus its overrides would produce. Used for the live
// "this makes N bins" line, so the number is visible before previewing.
export function countBins(form, overrides) {
  const racks = Number(form.racks) || 0;
  let n = 0;
  for (let r = 1; r <= racks; r++) {
    const hit = overrides.find((o) => r >= Number(o.rack_from) && r <= Number(o.rack_to));
    n += (Number(hit?.shelves ?? form.shelves) || 0) * (Number(hit?.bins ?? form.bins) || 0);
  }
  return n;
}

// Total units the same grid would hold. Deliberately walks the racks the way
// countBins does rather than multiplying its result by form.bin_capacity: an
// override may set its own capacity per bin, and racks outside it keep the base
// one, so there is no single multiplier. Display only — the server computes the
// real figure as SUM(rack_master.capacity) once the layout is applied.
export function countCapacity(form, overrides) {
  const racks = Number(form.racks) || 0;
  let n = 0;
  for (let r = 1; r <= racks; r++) {
    const hit = overrides.find((o) => r >= Number(o.rack_from) && r <= Number(o.rack_to));
    n += (Number(hit?.shelves ?? form.shelves) || 0)
       * (Number(hit?.bins ?? form.bins) || 0)
       * (Number(hit?.bin_capacity ?? form.bin_capacity) || 0);
  }
  return n;
}

// Ranges may not overlap — the server rejects them, but catching it here means
// the user sees it while typing instead of after a round trip.
export function findOverlap(overrides) {
  const sorted = [...overrides]
    .map((o) => ({ from: Number(o.rack_from), to: Number(o.rack_to) }))
    .filter((o) => o.from && o.to)
    .sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from <= sorted[i - 1].to) {
      return `Ranges ${sorted[i - 1].from}–${sorted[i - 1].to} and ${sorted[i].from}–${sorted[i].to} overlap`;
    }
  }
  return null;
}
