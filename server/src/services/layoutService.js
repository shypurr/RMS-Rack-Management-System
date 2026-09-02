// From the leaf module, not from rackService — rackService imports getOrgWidths
// from this file, so importing it back would close a cycle.
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { writeAudit } from './audit.js';
import { widthsFor } from '../lib/rackCode.js';

// Turning an organization's layout configuration into a concrete set of bins.
//
// The layout is an ordered list of rack GROUPS (table `rack_group`), one per
// batch of racks the user added. Each group says how many racks, and how each
// of those racks is divided. rack_master holds the bins generated from them.
//
// This replaced a base grid plus "ranges that differ from the base". That model
// was accurate but nobody could hold it in their head: to add ten odd racks you
// first had to understand which racks were exceptions to what. A flat list of
// batches needs no such explanation — you add racks, they go on the end.
//
// Racks are only ever APPENDED here. Removing them is a separate flow with its
// own rules (empty racks only), which is why addRacks below cannot delete a bin
// even if asked: there is no parameter that would express it.

// Every bin one group calls for, in rack/shelf/bin order.
export function binsForGroup({ rack_from, rack_to, shelves, bins, bin_capacity }) {
  const out = [];
  for (let rack_no = rack_from; rack_no <= rack_to; rack_no++) {
    for (let shelf_no = 1; shelf_no <= shelves; shelf_no++) {
      for (let bin_no = 1; bin_no <= bins; bin_no++) {
        out.push({ rack_no, shelf_no, bin_no, capacity: bin_capacity });
      }
    }
  }
  return out;
}

// Every bin a whole list of groups calls for. Pure — it describes what SHOULD
// exist; diffing against what does exist is separate.
export function buildTargetBins(groups) {
  return groups.flatMap(binsForGroup);
}

// The inverse: read a set of existing racks back into the groups that would
// describe them. Consecutive racks of an identical shape fold into one group.
//
// This is how a warehouse built under the old base-grid model gets a group list
// without anybody re-entering it — see the 2026-09-02-rack-groups migration.
// It lives here, next to binsForGroup, because the two must agree: feeding this
// function's output back through buildTargetBins has to reproduce the bins it
// was derived from, or the migration would silently misdescribe the racks.
//
// `rows` is one row per rack, ordered by org then rack_no, each carrying
// { fk_org_id, rack_no, shelves, bins, min_cap, max_cap, bin_count }.
//
// A ragged rack — mixed capacities, or fewer bins than shelves × bins implies —
// cannot be folded, because one group has a single shape and a single capacity.
// Those become single-rack groups carrying their largest values, so the group
// list still covers every rack and the next add still appends cleanly after it.
export function coalesceRackGroups(rows) {
  const groups = [];
  for (const r of rows) {
    const shelves = Number(r.shelves);
    const bins = Number(r.bins);
    const rack_no = Number(r.rack_no);
    const bin_capacity = Number(r.max_cap);
    const uniform = Number(r.min_cap) === Number(r.max_cap)
      && Number(r.bin_count) === shelves * bins;

    const prev = groups.at(-1);
    const extends_prev = prev
      && prev.fk_org_id === r.fk_org_id
      && prev.rack_to === rack_no - 1
      && prev.uniform && uniform
      && prev.shelves === shelves
      && prev.bins === bins
      && prev.bin_capacity === bin_capacity;

    if (extends_prev) prev.rack_to = rack_no;
    else groups.push({
      fk_org_id: r.fk_org_id,
      rack_from: rack_no, rack_to: rack_no,
      shelves, bins, bin_capacity, uniform,
    });
  }
  return groups;
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
  const [[layout]] = await pool.query(
    'SELECT version FROM rack_layout WHERE fk_org_id = ?', [orgId]
  );
  const [groups] = await pool.query(
    `SELECT id, seq, rack_from, rack_to, shelves, bins, bin_capacity, created_at
     FROM rack_group WHERE fk_org_id = ? ORDER BY seq, id`,
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
    groups: groups.map((g) => ({
      ...g,
      rack_count: g.rack_to - g.rack_from + 1,
      bin_count: (g.rack_to - g.rack_from + 1) * g.shelves * g.bins,
      capacity: (g.rack_to - g.rack_from + 1) * g.shelves * g.bins * g.bin_capacity,
    })),
    widths: await getOrgWidths(orgId),
    counts: {
      bins: Number(counts.bins),
      racks: Number(counts.racks),
      capacity: Number(counts.capacity),
    },
    version: layout?.version ?? 1,
  };
}

// Existing bins with the numbers the diff needs. Exported alongside
// diffLayout/findBlockers: adding racks has no use for them, but the coming
// remove-racks flow needs exactly this trio to decide what it may delete.
export async function existingBins(orgId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, rack_no, shelf_no, bin_no, capacity, used
     FROM rack_master WHERE fk_org_id = ? ORDER BY rack_no, shelf_no, bin_no`,
    [orgId]
  );
  return rows;
}

// A batch is four positive integers and nothing else. The ceiling is not
// arbitrary: each rack is shelves × bins rows in rack_master, so a fat-fingered
// extra zero is the difference between 1,000 inserts and 10,000,000.
const MAX_BINS_PER_ADD = 100_000;

function validateBatch({ racks, shelves, bins, bin_capacity }) {
  for (const [name, value] of Object.entries({ racks, shelves, bins, bin_capacity })) {
    if (!Number.isInteger(Number(value)) || Number(value) <= 0) {
      throw new HttpError(400, `${name} must be a positive integer`);
    }
  }
  const total = Number(racks) * Number(shelves) * Number(bins);
  if (total > MAX_BINS_PER_ADD) {
    throw new HttpError(
      400,
      `That is ${total.toLocaleString()} bins in one go (limit ${MAX_BINS_PER_ADD.toLocaleString()}). ` +
      'Check the numbers, or add the racks in smaller batches.'
    );
  }
}

// ── adding racks ──────────────────────────────────────────────────────────
// The only way the layout ever changes. One batch: N racks of a given shape,
// appended after the highest rack number this organization already has.
//
// Note what this function CANNOT do. It takes no target state and computes no
// diff, so there is no input that makes it delete or shrink a bin. Removing
// racks is a separate flow with its own rules (empty racks only) — keeping the
// two apart is what stops a mistyped number in a setup form from deleting a
// warehouse. `diffLayout`/`findBlockers` above stay for that flow to use.
export async function addRacks(orgId, { racks, shelves, bins, bin_capacity, userId = 'system' }) {
  if (!orgId) throw new HttpError(500, 'addRacks requires an orgId');
  validateBatch({ racks, shelves, bins, bin_capacity });
  const rackCount = Number(racks);
  const shape = {
    shelves: Number(shelves), bins: Number(bins), bin_capacity: Number(bin_capacity),
  };

  return withTransaction(async (conn) => {
    // Lock the org's layout row so two concurrent adds queue rather than both
    // reading the same MAX(rack_no) and generating colliding racks. The row may
    // not exist yet on a first-ever add; the INSERT below creates it, and the
    // rack_master unique key is the backstop either way.
    await conn.query('SELECT version FROM rack_layout WHERE fk_org_id = ? FOR UPDATE', [orgId]);
    const [[{ maxRack }]] = await conn.query(
      'SELECT COALESCE(MAX(rack_no), 0) AS maxRack FROM rack_master WHERE fk_org_id = ?',
      [orgId]
    );

    const group = {
      rack_from: Number(maxRack) + 1,
      rack_to: Number(maxRack) + rackCount,
      ...shape,
    };
    const newBins = binsForGroup(group);

    // Chunked: one 500-row statement is fine, 15,000 is not.
    for (let i = 0; i < newBins.length; i += 500) {
      const chunk = newBins.slice(i, i + 500);
      await conn.query(
        'INSERT INTO rack_master (fk_org_id, rack_no, shelf_no, bin_no, capacity) VALUES ?',
        [chunk.map((b) => [orgId, b.rack_no, b.shelf_no, b.bin_no, b.capacity])]
      );
    }

    // seq is the group's place in this org's list, so it counts groups, not
    // racks — and is computed under the same lock as the rack numbers.
    const [[{ maxSeq }]] = await conn.query(
      'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM rack_group WHERE fk_org_id = ?',
      [orgId]
    );
    await conn.query(
      `INSERT INTO rack_group (fk_org_id, seq, rack_from, rack_to, shelves, bins, bin_capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orgId, Number(maxSeq) + 1, group.rack_from, group.rack_to,
       shape.shelves, shape.bins, shape.bin_capacity]
    );

    // The header row exists to be locked and to carry `version`; the legacy
    // grid columns are left NULL deliberately.
    const [[current]] = await conn.query(
      'SELECT version FROM rack_layout WHERE fk_org_id = ?', [orgId]
    );
    const nextVersion = (current?.version ?? 0) + 1;
    await conn.query(
      `INSERT INTO rack_layout (fk_org_id, version) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE version = VALUES(version)`,
      [orgId, nextVersion]
    );

    // One audit row for the whole batch — 15,000 individual bin rows would bury
    // every other entry in the log.
    await writeAudit(conn, {
      orgId,
      entityType: 'rack',
      entityId: `layout:${orgId}`,
      action: 'add',
      before: null,
      after: {
        racks: rackCount, ...shape,
        rack_from: group.rack_from, rack_to: group.rack_to,
        binsAdded: newBins.length,
      },
      userId,
    });

    return {
      added: newBins.length,
      racks: rackCount,
      rack_from: group.rack_from,
      rack_to: group.rack_to,
      version: nextVersion,
    };
  });
}
