import { pool, withTransaction } from '../db.js';
import { writeAudit } from './audit.js';
import { getOrgWidths } from './layoutService.js';
import { decorateRack, decorateRacks } from '../lib/rackCode.js';
import { HttpError } from '../lib/httpError.js';

// Moved to src/lib/httpError.js so layoutService can throw it without creating
// an import cycle (this file needs getOrgWidths from layoutService). Still
// re-exported here for the modules that already import it from this path.
export { HttpError };

// Every function here takes orgId FIRST and refuses to run without it. A
// forgotten tenancy filter must fail loudly rather than quietly serve another
// organization's stock — which is exactly the bug this replaced.
function assertOrg(orgId, fn) {
  if (!orgId) throw new HttpError(500, `${fn} requires an orgId`);
}

// ── low-level helpers (operate on a transaction connection) ────────────────
// The org predicate is in the WHERE clause, not checked after the fact: a rack
// belonging to someone else must be indistinguishable from one that does not
// exist, so probing ids leaks nothing.
async function getRackForUpdate(conn, orgId, rackId) {
  const [rows] = await conn.query(
    `SELECT id, rack_no, shelf_no, bin_no, capacity, used, status
     FROM rack_master WHERE id = ? AND fk_org_id = ? FOR UPDATE`,
    [rackId, orgId]
  );
  if (!rows.length) throw new HttpError(404, `Rack ${rackId} not found`);
  return rows[0];
}

async function getItemForUpdate(conn, orgId, id) {
  const [rows] = await conn.query(
    'SELECT * FROM item_location WHERE id = ? AND fk_org_id = ? FOR UPDATE',
    [id, orgId]
  );
  if (!rows.length) throw new HttpError(404, `Item location ${id} not found`);
  return rows[0];
}

// Recompute used = SUM(qty) and derive status. Single source of truth for both.
async function recalcRack(conn, orgId, rackId) {
  const [[row]] = await conn.query(
    'SELECT COALESCE(SUM(qty),0) AS total FROM item_location WHERE fk_rack_id = ? AND fk_org_id = ?',
    [rackId, orgId]
  );
  const total = Number(row.total); // SUM() comes back as a string; coerce for the === 0 check
  const status = total === 0 ? 'Vacant' : 'Occupied';
  await conn.query(
    'UPDATE rack_master SET used = ?, status = ? WHERE id = ? AND fk_org_id = ?',
    [total, status, rackId, orgId]
  );
  return { used: total, status };
}

// Guard: a rack's used may never exceed capacity. `code` is the display label,
// which the caller derives — this module never invents one.
function assertCapacity(rack, projectedUsed, code) {
  if (projectedUsed > rack.capacity) {
    throw new HttpError(409, `Capacity exceeded for ${code}: ${projectedUsed}/${rack.capacity}`);
  }
}

// ── read operations (no transaction needed) ───────────────────────────────
export async function listRacks(orgId) {
  assertOrg(orgId, 'listRacks');
  const [rows] = await pool.query(
    `SELECT id, rack_no, shelf_no, bin_no, capacity, used, (capacity - used) AS available, status
     FROM rack_master WHERE fk_org_id = ?
     ORDER BY rack_no, shelf_no, bin_no`,
    [orgId]
  );
  // Numeric ORDER BY, so R10 no longer sorts before R2 the way a string key did.
  return decorateRacks(rows, await getOrgWidths(orgId));
}

export async function getRackWithItems(orgId, rackId) {
  assertOrg(orgId, 'getRackWithItems');
  const [rack] = await pool.query(
    `SELECT id, rack_no, shelf_no, bin_no, capacity, used, (capacity - used) AS available, status
     FROM rack_master WHERE id = ? AND fk_org_id = ?`,
    [rackId, orgId]
  );
  if (!rack.length) throw new HttpError(404, `Rack ${rackId} not found`);
  const [items] = await pool.query(
    `SELECT id, item, color, size, qty, module_id, module_type, updated_at
     FROM item_location WHERE fk_rack_id = ? AND fk_org_id = ? ORDER BY item, color, size`,
    [rackId, orgId]
  );
  return { ...decorateRack(rack[0], await getOrgWidths(orgId)), items };
}

// Find every rack that already holds this exact item (item + color + size),
// with each rack's current free space — powers the "already placed" hint.
export async function findPlacements(orgId, { item, color = '', size = '' }) {
  assertOrg(orgId, 'findPlacements');
  if (!item) return [];
  const [rows] = await pool.query(
    `SELECT il.id, il.fk_rack_id, il.qty,
            rm.rack_no, rm.shelf_no, rm.bin_no,
            rm.capacity, rm.used, (rm.capacity - rm.used) AS available
     FROM item_location il
     JOIN rack_master rm ON rm.id = il.fk_rack_id
     WHERE il.fk_org_id = ? AND il.item = ? AND il.color = ? AND il.size = ?
     ORDER BY il.qty DESC`,
    [orgId, item, color, size]
  );
  // `rack_id` stays the human code so the placement cards render unchanged;
  // `fk_rack_id` is what the client sends back when choosing this rack.
  return decorateRacks(rows, await getOrgWidths(orgId));
}

// ── write operations ──────────────────────────────────────────────────────
export async function addItem(orgId, { rackId, item, color = '', size = '', qty, moduleType = null, moduleId = null, userId = 'system' }) {
  assertOrg(orgId, 'addItem');
  qty = Number(qty);
  if (!item || !Number.isInteger(qty) || qty <= 0) {
    throw new HttpError(400, 'item and a positive integer qty are required');
  }
  const widths = await getOrgWidths(orgId);
  return withTransaction(async (conn) => {
    const rack = await getRackForUpdate(conn, orgId, rackId);
    const code = decorateRack(rack, widths).rack_id;
    assertCapacity(rack, rack.used + qty, code);

    // Merge into an identical row already in this rack (same item/color/size),
    // else insert a new row — so the same product never duplicates within a rack.
    const [existing] = await conn.query(
      `SELECT id, qty FROM item_location
       WHERE fk_org_id = ? AND fk_rack_id = ? AND item = ? AND color = ? AND size = ? LIMIT 1 FOR UPDATE`,
      [orgId, rackId, item, color, size]
    );
    let itemId, before, after;
    if (existing.length) {
      const newQty = existing[0].qty + qty;
      await conn.query('UPDATE item_location SET qty = ? WHERE id = ?', [newQty, existing[0].id]);
      itemId = existing[0].id;
      before = { id: itemId, item, color, size, qty: existing[0].qty, fk_rack_id: rackId, rack_id: code };
      after = { id: itemId, item, color, size, qty: newQty, fk_rack_id: rackId, rack_id: code, module_type: moduleType, module_id: moduleId };
    } else {
      const [res] = await conn.query(
        `INSERT INTO item_location (fk_org_id, item, color, size, qty, fk_rack_id, module_id, module_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orgId, item, color, size, qty, rackId, moduleId, moduleType]
      );
      itemId = res.insertId;
      before = null;
      after = { id: itemId, item, color, size, qty, fk_rack_id: rackId, rack_id: code, module_type: moduleType, module_id: moduleId };
    }
    const rackState = await recalcRack(conn, orgId, rackId);
    await writeAudit(conn, { orgId, entityType: 'item_location', entityId: itemId, action: 'add', before, after, userId });
    return { item: after, rack: { id: rackId, rack_id: code, ...rackState }, merged: existing.length > 0 };
  });
}

export async function updateItemQty(orgId, { id, qty, userId = 'system' }) {
  assertOrg(orgId, 'updateItemQty');
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty < 0) {
    throw new HttpError(400, 'qty must be an integer >= 0 (0 removes the item)');
  }
  const widths = await getOrgWidths(orgId);
  return withTransaction(async (conn) => {
    const before = await getItemForUpdate(conn, orgId, id);
    const rack = await getRackForUpdate(conn, orgId, before.fk_rack_id);
    const code = decorateRack(rack, widths).rack_id;
    const projectedUsed = rack.used - before.qty + qty;
    assertCapacity(rack, projectedUsed, code);

    let action;
    if (qty === 0) {
      await conn.query('DELETE FROM item_location WHERE id = ?', [id]);
      action = 'remove';
    } else {
      await conn.query('UPDATE item_location SET qty = ? WHERE id = ?', [qty, id]);
      action = 'update';
    }
    const rackState = await recalcRack(conn, orgId, before.fk_rack_id);
    await writeAudit(conn, {
      orgId, entityType: 'item_location', entityId: id, action,
      before: { ...before, rack_id: code },
      after: qty === 0 ? null : { ...before, qty, rack_id: code },
      userId,
    });
    return { removed: qty === 0, rack: { id: before.fk_rack_id, rack_id: code, ...rackState } };
  });
}

// Picklist fulfilment (Flow C): deduct every picked quantity against one
// Delivery Challan in a single transaction. Deduction only — a rack's `used`
// can only fall here, so there is no capacity check.
export async function pickItems(orgId, { picks, dcNo, userId = 'system' }) {
  assertOrg(orgId, 'pickItems');
  if (!Array.isArray(picks) || !picks.length) {
    throw new HttpError(400, 'picks must be a non-empty array');
  }
  // Normalize first so a bad row fails before anything is locked.
  const normalized = picks.map((p) => {
    const id = Number(p.itemLocationId);
    const qty = Number(p.qty);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(qty) || qty <= 0) {
      throw new HttpError(400, 'each pick needs an itemLocationId and a positive integer qty');
    }
    return { id, qty };
  });

  // The same item_location row can appear twice if the client sends a split;
  // collapse so we lock and audit each row exactly once.
  const byId = new Map();
  for (const p of normalized) byId.set(p.id, (byId.get(p.id) || 0) + p.qty);
  // Ascending id order: two picklists touching the same rows lock them in the
  // same sequence and queue instead of deadlocking.
  const ordered = [...byId.entries()].sort((a, b) => a[0] - b[0]);

  const widths = await getOrgWidths(orgId);
  return withTransaction(async (conn) => {
    const rackIds = new Set();
    let removed = 0, updated = 0, totalQty = 0;

    for (const [id, qty] of ordered) {
      const before = await getItemForUpdate(conn, orgId, id);
      const rackRow = await getRackForUpdate(conn, orgId, before.fk_rack_id);
      const code = decorateRack(rackRow, widths).rack_id;
      if (qty > before.qty) {
        throw new HttpError(
          400,
          `Cannot pick ${qty} of ${before.item} from ${code}; only ${before.qty} in stock`
        );
      }
      const remaining = before.qty - qty;
      if (remaining === 0) {
        await conn.query('DELETE FROM item_location WHERE id = ?', [id]);
        removed += 1;
      } else {
        await conn.query('UPDATE item_location SET qty = qty - ? WHERE id = ?', [qty, id]);
        updated += 1;
      }
      rackIds.add(before.fk_rack_id);
      totalQty += qty;
      // `remove` when the row empties, `update` when it survives — both already
      // in the audit_log.action ENUM, and both also mean "someone edited a
      // quantity by hand". `source: 'picklist'` is what separates the two, so
      // the Audit Log still shows WHY the stock left even when there is no
      // challan number. `picklist` is added only when one is actually known.
      const after = { source: 'picklist', pickedQty: qty, remainingQty: remaining, rack: code };
      if (dcNo) after.picklist = dcNo;
      await writeAudit(conn, {
        orgId, entityType: 'item_location', entityId: id,
        action: remaining === 0 ? 'remove' : 'update',
        before, after, userId,
      });
    }

    // Once per distinct rack, after all deductions — a rack hit by two picks
    // must not be recalculated against a half-applied state.
    const racks = [];
    for (const rackId of rackIds) {
      const state = await recalcRack(conn, orgId, rackId);
      const [[row]] = await conn.query(
        'SELECT rack_no, shelf_no, bin_no FROM rack_master WHERE id = ? AND fk_org_id = ?',
        [rackId, orgId]
      );
      racks.push({ id: rackId, rack_id: decorateRack(row, widths).rack_id, ...state });
    }
    return { racks, removed, updated, pickedQty: totalQty };
  });
}

// Atomic move: deduct from source row, merge into a same-item row in the
// destination rack (or create one), recalc BOTH racks. All-or-nothing.
export async function moveItem(orgId, { itemId, toRackId, qty, userId = 'system' }) {
  assertOrg(orgId, 'moveItem');
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'qty must be a positive integer');
  const widths = await getOrgWidths(orgId);
  return withTransaction(async (conn) => {
    const src = await getItemForUpdate(conn, orgId, itemId);
    if (Number(toRackId) === Number(src.fk_rack_id)) {
      throw new HttpError(400, 'Destination rack is the same as source');
    }
    if (qty > src.qty) throw new HttpError(400, `Cannot move ${qty}; only ${src.qty} in stock`);

    const srcRackId = src.fk_rack_id;
    // Lock both racks in ascending id order so two opposing moves queue instead
    // of deadlocking.
    const [lowId, highId] = [srcRackId, Number(toRackId)].sort((a, b) => a - b);
    const lockedLow = await getRackForUpdate(conn, orgId, lowId);
    const lockedHigh = await getRackForUpdate(conn, orgId, highId);
    const srcRack = lowId === Number(srcRackId) ? lockedLow : lockedHigh;
    const destRack = lowId === Number(toRackId) ? lockedLow : lockedHigh;
    const srcCode = decorateRack(srcRack, widths).rack_id;
    const destCode = decorateRack(destRack, widths).rack_id;
    assertCapacity(destRack, destRack.used + qty, destCode);

    // Deduct from source (delete the row if it empties out).
    if (qty === src.qty) {
      await conn.query('DELETE FROM item_location WHERE id = ?', [itemId]);
    } else {
      await conn.query('UPDATE item_location SET qty = qty - ? WHERE id = ?', [qty, itemId]);
    }

    // Merge into an identical row in the destination, else insert a new one.
    const [existing] = await conn.query(
      `SELECT id, qty FROM item_location
       WHERE fk_org_id = ? AND fk_rack_id = ? AND item = ? AND color = ? AND size = ? LIMIT 1 FOR UPDATE`,
      [orgId, toRackId, src.item, src.color, src.size]
    );
    if (existing.length) {
      await conn.query('UPDATE item_location SET qty = qty + ? WHERE id = ?', [qty, existing[0].id]);
    } else {
      await conn.query(
        `INSERT INTO item_location (fk_org_id, item, color, size, qty, fk_rack_id, module_id, module_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orgId, src.item, src.color, src.size, qty, toRackId, src.module_id, src.module_type]
      );
    }

    const srcState = await recalcRack(conn, orgId, srcRackId);
    const destState = await recalcRack(conn, orgId, toRackId);
    await writeAudit(conn, {
      orgId, entityType: 'item_location', entityId: itemId, action: 'move',
      before: { rack: srcCode, item: src.item, color: src.color, size: src.size, qty: src.qty },
      after: { fromRack: srcCode, toRack: destCode, movedQty: qty },
      userId,
    });
    return {
      from: { id: srcRackId, rack_id: srcCode, ...srcState },
      to: { id: Number(toRackId), rack_id: destCode, ...destState },
    };
  });
}
