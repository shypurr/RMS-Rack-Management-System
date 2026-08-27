// From the leaf module, not from rackService — rackService imports getOrgWidths
// from this file, so importing it back would close a cycle.
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { writeAudit } from './audit.js';
import { widthsFor } from '../lib/rackCode.js';

// Turning an organization's layout configuration into a concrete set of bins.
//
// Two tables describe the layout: rack_layout (the base grid) and
// rack_group_override (ranges of racks that differ). rack_master holds the bins
// actually generated from them. This module is the only place that translates
// between the two.

// Which configuration governs one rack. Overrides are PINS, not offsets: a rack
// covered by an override ignores later changes to the base grid entirely, so
// editing the base cannot silently mutate racks the user deliberately
// customized. A NULL column still inherits, so an override can change shelves
// alone without restating capacity.
export function configFor(rackNo, layout, overrides) {
  const hit = overrides.find((o) => rackNo >= o.rack_from && rackNo <= o.rack_to);
  if (!hit) {
    return { shelves: layout.shelves, bins: layout.bins, bin_capacity: layout.bin_capacity };
  }
  return {
    shelves: hit.shelves ?? layout.shelves,
    bins: hit.bins ?? layout.bins,
    bin_capacity: hit.bin_capacity ?? layout.bin_capacity,
  };
}

// Ranges must not overlap: with two rules covering one rack, which wins would
// depend on row order, and the user could not predict the result.
export function assertNoOverlap(overrides) {
  const sorted = [...overrides].sort((a, b) => a.rack_from - b.rack_from);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.rack_from <= prev.rack_to) {
      throw new HttpError(
        400,
        `Rack ranges overlap: ${prev.rack_from}–${prev.rack_to} and ${cur.rack_from}–${cur.rack_to}`
      );
    }
  }
}

// Every bin the configuration calls for, in rack/shelf/bin order. Pure — it
// describes what SHOULD exist; diffing against what does exist is separate.
export function buildTargetBins(layout, overrides) {
  assertNoOverlap(overrides);
  const bins = [];
  for (let rack_no = 1; rack_no <= layout.racks; rack_no++) {
    const cfg = configFor(rack_no, layout, overrides);
    for (let shelf_no = 1; shelf_no <= cfg.shelves; shelf_no++) {
      for (let bin_no = 1; bin_no <= cfg.bins; bin_no++) {
        bins.push({ rack_no, shelf_no, bin_no, capacity: cfg.bin_capacity });
      }
    }
  }
  return bins;
}

// ── diffing against what already exists ───────────────────────────────────
// A bin's identity within an org is its coordinates, not its surrogate id —
// that is what lets us tell "this bin survives" from "this bin is new".
const keyOf = (b) => `${b.rack_no}:${b.shelf_no}:${b.bin_no}`;

export function diffLayout(existing, target) {
  const existingByKey = new Map(existing.map((b) => [keyOf(b), b]));
  const targetByKey = new Map(target.map((b) => [keyOf(b), b]));

  const add = target.filter((b) => !existingByKey.has(keyOf(b)));
  const remove = existing.filter((b) => !targetByKey.has(keyOf(b)));
  // `keep` carries both sides so the capacity comparison has what it needs.
  const keep = existing
    .filter((b) => targetByKey.has(keyOf(b)))
    .map((b) => ({ ...b, newCapacity: targetByKey.get(keyOf(b)).capacity }));

  return { add, keep, remove };
}

// The two conditions that make a layout change refuse to run. Both are about
// stock that is physically in a bin: one would delete it, the other would leave
// the bin holding more than it is allowed to.
export function findBlockers({ keep, remove }) {
  const blockers = [];
  for (const bin of remove) {
    if (Number(bin.used) > 0) blockers.push({ kind: 'occupied', ...bin });
  }
  for (const bin of keep) {
    if (bin.newCapacity < Number(bin.used)) {
      blockers.push({ kind: 'capacity', ...bin, capacity: bin.newCapacity });
    }
  }
  return blockers;
}

// ── reads ─────────────────────────────────────────────────────────────────
// Pad widths come from the bins that actually exist, not from the configured
// counts — during an apply the two disagree, and what the user sees must match
// what is stored.
export async function getOrgWidths(orgId) {
  if (!orgId) throw new HttpError(500, 'getOrgWidths requires an orgId');
  const [[row]] = await pool.query(
    `SELECT COALESCE(MAX(rack_no),0) AS maxRack,
            COALESCE(MAX(shelf_no),0) AS maxShelf,
            COALESCE(MAX(bin_no),0)  AS maxBin
     FROM rack_master WHERE fk_org_id = ?`,
    [orgId]
  );
  return widthsFor(row);
}

export async function getLayout(orgId) {
  if (!orgId) throw new HttpError(500, 'getLayout requires an orgId');
  const [[layout]] = await pool.query('SELECT * FROM rack_layout WHERE fk_org_id = ?', [orgId]);
  const [overrides] = await pool.query(
    `SELECT id, rack_from, rack_to, shelves, bins, bin_capacity
     FROM rack_group_override WHERE fk_org_id = ? ORDER BY rack_from`,
    [orgId]
  );
  const [[counts]] = await pool.query(
    `SELECT COUNT(*) AS bins, COUNT(DISTINCT rack_no) AS racks,
            COALESCE(SUM(capacity),0) AS capacity
     FROM rack_master WHERE fk_org_id = ?`,
    [orgId]
  );
  return {
    // `configured` is about bins on the ground, not a config row: an org with a
    // saved layout but no generated bins still cannot store anything.
    configured: Number(counts.bins) > 0,
    layout: layout || null,
    overrides,
    widths: await getOrgWidths(orgId),
    counts: {
      bins: Number(counts.bins),
      racks: Number(counts.racks),
      capacity: Number(counts.capacity),
    },
    version: layout?.version ?? 1,
  };
}

// Existing bins with the numbers the diff needs.
async function existingBins(orgId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, rack_no, shelf_no, bin_no, capacity, used
     FROM rack_master WHERE fk_org_id = ? ORDER BY rack_no, shelf_no, bin_no`,
    [orgId]
  );
  return rows;
}

function validateConfig({ racks, shelves, bins, bin_capacity }) {
  for (const [name, value] of Object.entries({ racks, shelves, bins, bin_capacity })) {
    if (!Number.isInteger(Number(value)) || Number(value) <= 0) {
      throw new HttpError(400, `${name} must be a positive integer`);
    }
  }
}

// ── preview ───────────────────────────────────────────────────────────────
// Writes nothing. The client shows the counts, or the blocking list, and the
// user decides. This is the first of the two gates: no bin is ever removed
// without the user seeing a number and answering yes.
export async function previewLayout(orgId, { racks, shelves, bins, bin_capacity, overrides = [] }) {
  if (!orgId) throw new HttpError(500, 'previewLayout requires an orgId');
  validateConfig({ racks, shelves, bins, bin_capacity });
  const target = buildTargetBins({ racks, shelves, bins, bin_capacity }, overrides);
  const diff = diffLayout(await existingBins(orgId), target);
  const blockers = findBlockers(diff);
  const { version } = await getLayout(orgId);
  return {
    add: diff.add.length,
    remove: diff.remove.length,
    keep: diff.keep.length,
    blockers,
    version,
    counts: { bins: target.length, racks: Number(racks) },
  };
}

// ── apply ─────────────────────────────────────────────────────────────────
// The second gate. Everything happens in one transaction, and the whole change
// is refused rather than partially applied if anything blocks.
export async function applyLayout(orgId, { racks, shelves, bins, bin_capacity, overrides = [], version, userId = 'system' }) {
  if (!orgId) throw new HttpError(500, 'applyLayout requires an orgId');
  validateConfig({ racks, shelves, bins, bin_capacity });
  assertNoOverlap(overrides);

  return withTransaction(async (conn) => {
    // Lock the config row first so two concurrent applies queue instead of
    // interleaving. FOR UPDATE on a row that does not exist yet is a no-op; the
    // INSERT below is guarded by the primary key.
    const [[current]] = await conn.query(
      'SELECT version FROM rack_layout WHERE fk_org_id = ? FOR UPDATE',
      [orgId]
    );
    const currentVersion = current?.version ?? 1;
    if (Number(version) !== currentVersion) {
      throw new HttpError(
        409,
        'The layout changed while you were editing it - reload and try again.'
      );
    }

    const target = buildTargetBins({ racks, shelves, bins, bin_capacity }, overrides);
    const diff = diffLayout(await existingBins(orgId, conn), target);
    const blockers = findBlockers(diff);
    if (blockers.length) {
      const occupied = blockers.filter((b) => b.kind === 'occupied').length;
      const overCapacity = blockers.length - occupied;
      const parts = [];
      if (occupied) parts.push(`${occupied} bin(s) still hold stock`);
      if (overCapacity) parts.push(`${overCapacity} bin(s) hold more than the new capacity`);
      const err = new HttpError(409, `Layout change refused: ${parts.join('; ')}.`);
      err.blockers = blockers;
      throw err;
    }

    // Removals first: coordinates that survive are in `keep`, never in both
    // lists, so a freed bin cannot collide with an insert below.
    if (diff.remove.length) {
      const ids = diff.remove.map((b) => b.id);
      for (let i = 0; i < ids.length; i += 1000) {
        await conn.query(
          'DELETE FROM rack_master WHERE fk_org_id = ? AND id IN (?)',
          [orgId, ids.slice(i, i + 1000)]
        );
      }
    }

    if (diff.add.length) {
      // Chunked: one 500-row statement is fine, 15,000 is not.
      for (let i = 0; i < diff.add.length; i += 500) {
        const chunk = diff.add.slice(i, i + 500);
        await conn.query(
          'INSERT INTO rack_master (fk_org_id, rack_no, shelf_no, bin_no, capacity) VALUES ?',
          [chunk.map((b) => [orgId, b.rack_no, b.shelf_no, b.bin_no, b.capacity])]
        );
      }
    }

    let updated = 0;
    for (const bin of diff.keep) {
      if (bin.newCapacity !== bin.capacity) {
        await conn.query('UPDATE rack_master SET capacity = ? WHERE id = ?', [bin.newCapacity, bin.id]);
        updated += 1;
      }
    }

    // Persist the configuration itself and bump the optimistic lock.
    await conn.query(
      `INSERT INTO rack_layout (fk_org_id, racks, shelves, bins, bin_capacity, version)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE racks = VALUES(racks), shelves = VALUES(shelves),
         bins = VALUES(bins), bin_capacity = VALUES(bin_capacity), version = VALUES(version)`,
      [orgId, racks, shelves, bins, bin_capacity, currentVersion + 1]
    );
    await conn.query('DELETE FROM rack_group_override WHERE fk_org_id = ?', [orgId]);
    for (const o of overrides) {
      await conn.query(
        `INSERT INTO rack_group_override (fk_org_id, rack_from, rack_to, shelves, bins, bin_capacity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orgId, o.rack_from, o.rack_to, o.shelves ?? null, o.bins ?? null, o.bin_capacity ?? null]
      );
    }

    // One audit row for the whole reconfiguration — 15,000 individual bin rows
    // would bury every other entry in the log.
    await writeAudit(conn, {
      orgId,
      entityType: 'rack',
      entityId: `layout:${orgId}`,
      action: diff.remove.length ? 'update' : 'add',
      before: { bins: diff.keep.length + diff.remove.length },
      after: {
        racks: Number(racks), shelves: Number(shelves), bins: Number(bins),
        bin_capacity: Number(bin_capacity), overrides: overrides.length,
        added: diff.add.length, removed: diff.remove.length, capacityChanged: updated,
      },
      userId,
    });

    return {
      added: diff.add.length,
      removed: diff.remove.length,
      updated,
      version: currentVersion + 1,
    };
  });
}
