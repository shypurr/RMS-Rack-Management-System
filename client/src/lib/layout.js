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
