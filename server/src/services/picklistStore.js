import { pool, withTransaction } from '../db.js';

// Picklist history. A row is written when a picklist is GENERATED — generating
// still changes no stock, but it does leave a trace, which is what makes
// "generated and never acted on" visible.
//
// Regenerating while iterating on the same challan updates the same row rather
// than adding another, so the history is one entry per picklist, not one per
// click of the button. Once its racks have been updated a row is closed: a
// further generate starts a new one, because that is a genuinely new pick.

const rackSummary = (placements) =>
  placements.filter((p) => p.suggested > 0).map((p) => `${p.rack_id} x${p.suggested}`).join(', ');

export async function savePicklist(orgId, { id, dcNo, party, source, rows, userId }) {
  if (!orgId) throw new Error('savePicklist requires an orgId');
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const short = rows.reduce((s, r) => s + r.shortage, 0);

  return withTransaction(async (conn) => {
    let picklistId = id;

    // Only reuse a row that is still open and belongs to this user.
    if (picklistId) {
      const [[existing]] = await conn.query(
        'SELECT id FROM picklist WHERE id = ? AND fk_org_id = ? AND rack_updated = 0 AND user_id = ?',
        [picklistId, orgId, userId]
      );
      if (!existing) picklistId = null;
    }

    if (picklistId) {
      await conn.query(
        `UPDATE picklist SET dc_no = ?, party = ?, source = ?, total_qty = ?, short_qty = ?
         WHERE id = ? AND fk_org_id = ?`,
        [dcNo || null, party || '', source, total, short, picklistId, orgId]
      );
      await conn.query('DELETE FROM picklist_line WHERE fk_picklist_id = ?', [picklistId]);
    } else {
      const [res] = await conn.query(
        `INSERT INTO picklist (fk_org_id, dc_no, party, source, total_qty, short_qty, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orgId, dcNo || null, party || '', source, total, short, userId]
      );
      picklistId = res.insertId;
    }

    if (rows.length) {
      await conn.query(
        `INSERT INTO picklist_line
           (fk_picklist_id, item, color, size, qty, available, shortage, racks)
         VALUES ?`,
        [rows.map((r) => [picklistId, r.item, r.color, r.size, r.qty, r.available, r.shortage, rackSummary(r.placements)])]
      );
    }
    return picklistId;
  });
}

// Called after the racks are actually updated. Closes the row so the history
// can say whether a picklist was acted on.
export async function markRackUpdated(orgId, id, pickedQty) {
  if (!orgId) throw new Error('markRackUpdated requires an orgId');
  if (!id) return;
  // The org predicate means a stale id from another organization updates
  // nothing rather than closing their picklist.
  await pool.query(
    'UPDATE picklist SET rack_updated = 1, picked_qty = ?, picked_at = NOW() WHERE id = ? AND fk_org_id = ?',
    [pickedQty, id, orgId]
  );
}

export async function listPicklists(orgId, limit = 100) {
  if (!orgId) throw new Error('listPicklists requires an orgId');
  const [rows] = await pool.query(
    `SELECT p.id, p.dc_no, p.party, p.source, p.total_qty, p.short_qty,
            p.rack_updated, p.picked_qty, p.picked_at, p.user_id, p.created_at,
            COUNT(l.id) AS line_count
     FROM picklist p
     LEFT JOIN picklist_line l ON l.fk_picklist_id = p.id
     WHERE p.fk_org_id = ?
     GROUP BY p.id
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ?`,
    [orgId, limit]
  );
  // Aliased line_count, not `lines`: LINES is reserved in MySQL 8.
  return rows.map(({ line_count, ...r }) => ({
    ...r, rack_updated: !!r.rack_updated, lines: Number(line_count),
  }));
}

export async function getPicklist(orgId, id) {
  if (!orgId) throw new Error('getPicklist requires an orgId');
  const [[head]] = await pool.query(
    'SELECT * FROM picklist WHERE id = ? AND fk_org_id = ?', [id, orgId]
  );
  if (!head) return null;
  const [lines] = await pool.query(
    `SELECT item, color, size, qty, available, shortage, racks
     FROM picklist_line WHERE fk_picklist_id = ? ORDER BY id`,
    [id]
  );
  return { ...head, rack_updated: !!head.rack_updated, lines };
}
