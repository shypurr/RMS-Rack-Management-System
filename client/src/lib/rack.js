// Display-only occupancy bucket (reference look). The stored status is only
// Vacant/Occupied (SRS); this 4-way coloring is derived from used/capacity.
export function occupancyBucket(used, capacity) {
  if (!capacity || used === 0) return 'vacant';
  const pct = (used / capacity) * 100;
  if (pct < 50) return 'low';
  if (pct < 85) return 'partial';
  return 'full';
}

export function pct(used, capacity) {
  return capacity ? Math.round((used / capacity) * 100) : 0;
}

export function pctColorClass(p) {
  return p >= 85 ? 'red' : p >= 50 ? 'yellow' : 'green';
}

// Inbound modules — the Add Item source dropdown. Delivery Challan is outbound
// and belongs to the Picklist tab alone, so it is deliberately not in here.
export const MODULE_TYPES = ['Purchase Inward', 'Job Slip', 'Pack Design', 'Sales Return'];

export const PICK_MODULE_TYPE = 'Delivery Challan';

// Order racks for placement: fully-empty (Vacant) first, then most free space,
// dropping racks with no room. Shared by Add Item (Step 3) and Move (destination).
export function sortByEmptiness(racks) {
  return racks
    .filter((r) => r.available > 0)
    .sort((a, b) => {
      const av = a.status === 'Vacant' ? 1 : 0;
      const bv = b.status === 'Vacant' ? 1 : 0;
      if (av !== bv) return bv - av;      // Vacant racks first
      return b.available - a.available;   // then most free space
    });
}
