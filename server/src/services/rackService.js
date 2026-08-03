import { withTransaction } from '../db.js';
import { writeAudit } from './audit.js';

// Simple typed error so routes can map to HTTP status codes.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── low-level helpers (operate on a transaction connection) ────────────────
async function getRackForUpdate(conn, rackId) {
  const [rows] = await conn.query(
    'SELECT rack_id, capacity, used, status FROM rack_master WHERE rack_id = ? FOR UPDATE',
    [rackId]
  );
  if (!rows.length) throw new HttpError(404, `Rack ${rackId} not found`);
  return rows[0];
}

async function getItemForUpdate(conn, id) {
  const [rows] = await conn.query('SELECT * FROM item_location WHERE id = ? FOR UPDATE', [id]);
  if (!rows.length) throw new HttpError(404, `Item location ${id} not found`);
  return rows[0];
}

// Recompute used = SUM(qty) and derive status. Single source of truth for both.
async function recalcRack(conn, rackId) {
  const [[row]] = await conn.query(
    'SELECT COALESCE(SUM(qty),0) AS total FROM item_location WHERE fk_rack_id = ?',
    [rackId]
  );
  const total = Number(row.total); // SUM() comes back as a string; coerce for the === 0 check
  const status = total === 0 ? 'Vacant' : 'Occupied';
  await conn.query('UPDATE rack_master SET used = ?, status = ? WHERE rack_id = ?', [total, status, rackId]);
  return { used: total, status };
}

// Guard: a rack's used may never exceed capacity.
function assertCapacity(rack, projectedUsed) {
  if (projectedUsed > rack.capacity) {
    throw new HttpError(
      409,
      `Capacity exceeded for ${rack.rack_id}: ${projectedUsed}/${rack.capacity}`
    );
  }
}

// ── read operations (no transaction needed) ───────────────────────────────
export async function listRacks(pool) {
  const [rows] = await pool.query(
    `SELECT rack_id, capacity, used, (capacity - used) AS available, status
     FROM rack_master ORDER BY rack_id`
  );
  return rows;
}

export async function getRackWithItems(pool, rackId) {
  const [rack] = await pool.query(
    `SELECT rack_id, capacity, used, (capacity - used) AS available, status
     FROM rack_master WHERE rack_id = ?`,
    [rackId]
  );
  if (!rack.length) throw new HttpError(404, `Rack ${rackId} not found`);
  const [items] = await pool.query(
    `SELECT id, item, color, size, qty, module_id, module_type, updated_at
     FROM item_location WHERE fk_rack_id = ? ORDER BY item, color, size`,
    [rackId]
  );
  return { ...rack[0], items };
}

// Find every rack that already holds this exact item (item + color + size),
// with each rack's current free space — powers the "already placed" hint.
export async function findPlacements(pool, { item, color = '', size = '' }) {
  if (!item) return [];
  const [rows] = await pool.query(
    `SELECT il.id, il.fk_rack_id AS rack_id, il.qty,
            rm.capacity, rm.used, (rm.capacity - rm.used) AS available
     FROM item_location il
     JOIN rack_master rm ON rm.rack_id = il.fk_rack_id
     WHERE il.item = ? AND il.color = ? AND il.size = ?
     ORDER BY il.qty DESC`,
    [item, color, size]
  );
  return rows;
}

// ── write operations ──────────────────────────────────────────────────────
export async function addItem({ rackId, item, color = '', size = '', qty, moduleType = null, moduleId = null, userId = 'system' }) {
  qty = Number(qty);
  if (!item || !Number.isInteger(qty) || qty <= 0) {
    throw new HttpError(400, 'item and a positive integer qty are required');
  }
  return withTransaction(async (conn) => {
    const rack = await getRackForUpdate(conn, rackId);
    assertCapacity(rack, rack.used + qty);

    // Merge into an identical row already in this rack (same item/color/size),
    // else insert a new row — so the same product never duplicates within a rack.
    const [existing] = await conn.query(
      `SELECT id, qty FROM item_location
       WHERE fk_rack_id = ? AND item = ? AND color = ? AND size = ? LIMIT 1 FOR UPDATE`,
      [rackId, item, color, size]
    );
    let itemId, before, after;
    if (existing.length) {
      const newQty = existing[0].qty + qty;
      await conn.query('UPDATE item_location SET qty = ? WHERE id = ?', [newQty, existing[0].id]);
      itemId = existing[0].id;
      before = { id: itemId, item, color, size, qty: existing[0].qty, fk_rack_id: rackId };
      after = { id: itemId, item, color, size, qty: newQty, fk_rack_id: rackId, module_type: moduleType, module_id: moduleId };
    } else {
      const [res] = await conn.query(
        `INSERT INTO item_location (item, color, size, qty, fk_rack_id, module_id, module_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [item, color, size, qty, rackId, moduleId, moduleType]
      );
      itemId = res.insertId;
      before = null;
      after = { id: itemId, item, color, size, qty, fk_rack_id: rackId, module_type: moduleType, module_id: moduleId };
    }
    const rackState = await recalcRack(conn, rackId);
    await writeAudit(conn, { entityType: 'item_location', entityId: itemId, action: 'add', before, after, userId });
    return { item: after, rack: { rack_id: rackId, ...rackState }, merged: existing.length > 0 };
  });
}

export async function updateItemQty({ id, qty, userId = 'system' }) {
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty < 0) {
    throw new HttpError(400, 'qty must be an integer >= 0 (0 removes the item)');
  }
  return withTransaction(async (conn) => {
    const before = await getItemForUpdate(conn, id);
    const rack = await getRackForUpdate(conn, before.fk_rack_id);
    const projectedUsed = rack.used - before.qty + qty;
    assertCapacity(rack, projectedUsed);

    let action;
    if (qty === 0) {
      await conn.query('DELETE FROM item_location WHERE id = ?', [id]);
      action = 'remove';
    } else {
      await conn.query('UPDATE item_location SET qty = ? WHERE id = ?', [qty, id]);
      action = 'update';
    }
    const rackState = await recalcRack(conn, before.fk_rack_id);
    await writeAudit(conn, {
      entityType: 'item_location', entityId: id, action,
      before, after: qty === 0 ? null : { ...before, qty }, userId,
    });
    return { removed: qty === 0, rack: { rack_id: before.fk_rack_id, ...rackState } };
  });
}

// Picklist fulfilment (Flow C): deduct every picked quantity against one
// Delivery Challan in a single transaction. Deduction only — a rack's `used`
// can only fall here, so there is no capacity check.
export async function pickItems({ picks, dcNo, userId = 'system' }) {
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

  return withTransaction(async (conn) => {
    const rackIds = new Set();
    let removed = 0, updated = 0, totalQty = 0;

    for (const [id, qty] of ordered) {
      const before = await getItemForUpdate(conn, id);
      if (qty > before.qty) {
        throw new HttpError(
          400,
          `Cannot pick ${qty} of ${before.item} from ${before.fk_rack_id}; only ${before.qty} in stock`
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
      // in the audit_log.action ENUM. after_json carries the challan so the
      // Audit Log shows WHY the stock left.
      await writeAudit(conn, {
        entityType: 'item_location', entityId: id,
        action: remaining === 0 ? 'remove' : 'update',
        before,
        after: { picklist: dcNo, pickedQty: qty, remainingQty: remaining, rack: before.fk_rack_id },
        userId,
      });
    }

    // Once per distinct rack, after all deductions — a rack hit by two picks
    // must not be recalculated against a half-applied state.
    const racks = [];
    for (const rackId of rackIds) {
      racks.push({ rack_id: rackId, ...(await recalcRack(conn, rackId)) });
    }
    return { racks, removed, updated, pickedQty: totalQty };
  });
}

// Atomic move: deduct from source row, merge into a same-item row in the
// destination rack (or create one), recalc BOTH racks. All-or-nothing.
export async function moveItem({ itemId, toRackId, qty, userId = 'system' }) {
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'qty must be a positive integer');
  return withTransaction(async (conn) => {
    const src = await getItemForUpdate(conn, itemId);
    if (toRackId === src.fk_rack_id) throw new HttpError(400, 'Destination rack is the same as source');
    if (qty > src.qty) throw new HttpError(400, `Cannot move ${qty}; only ${src.qty} in stock`);

    const destRack = await getRackForUpdate(conn, toRackId);
    assertCapacity(destRack, destRack.used + qty);
    const srcRackId = src.fk_rack_id;

    // Deduct from source (delete the row if it empties out).
    if (qty === src.qty) {
      await conn.query('DELETE FROM item_location WHERE id = ?', [itemId]);
    } else {
      await conn.query('UPDATE item_location SET qty = qty - ? WHERE id = ?', [qty, itemId]);
    }

    // Merge into an identical row in the destination, else insert a new one.
    const [existing] = await conn.query(
      `SELECT id, qty FROM item_location
       WHERE fk_rack_id = ? AND item = ? AND color = ? AND size = ? LIMIT 1 FOR UPDATE`,
      [toRackId, src.item, src.color, src.size]
    );
    if (existing.length) {
      await conn.query('UPDATE item_location SET qty = qty + ? WHERE id = ?', [qty, existing[0].id]);
    } else {
      await conn.query(
        `INSERT INTO item_location (item, color, size, qty, fk_rack_id, module_id, module_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [src.item, src.color, src.size, qty, toRackId, src.module_id, src.module_type]
      );
    }

    const srcState = await recalcRack(conn, srcRackId);
    const destState = await recalcRack(conn, toRackId);
    await writeAudit(conn, {
      entityType: 'item_location', entityId: itemId, action: 'move',
      before: { rack: srcRackId, item: src.item, color: src.color, size: src.size, qty: src.qty },
      after: { fromRack: srcRackId, toRack: toRackId, movedQty: qty },
      userId,
    });
    return {
      from: { rack_id: srcRackId, ...srcState },
      to: { rack_id: toRackId, ...destState },
    };
  });
}
