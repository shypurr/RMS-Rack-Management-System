import { Router } from 'express';
import { pool } from '../db.js';
import { listPicklists } from '../services/picklistStore.js';

const router = Router();

// Operational history for the two stock-moving flows, each read from where
// that flow actually records itself:
//   putaway  → audit_log (`add` rows), which is already written on every add
//   picklist → the picklist table, which also knows about picklists that were
//              generated and then never acted on — audit_log cannot, because
//              generating writes no audit row by design.

const clampLimit = (v, fallback = 100) => Math.min(Number(v) || fallback, 500);

// GET /api/history/putaway?limit= — stock added to racks, newest first.
router.get('/putaway', async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit);
    const [rows] = await pool.query(
      `SELECT id, entity_id, before_json, after_json, user_id, created_at
       FROM audit_log
       WHERE fk_org_id = ? AND entity_type = 'item_location' AND action = 'add'
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [req.org.id, limit]
    );
    res.json(rows.map((r) => {
      const a = r.after_json || {};
      const b = r.before_json;
      // after_json holds the row AFTER the add, so when the add merged into an
      // existing row its qty is the running total, not what was put away.
      // The difference against before_json is the amount actually added.
      const added = b ? Number(a.qty ?? 0) - Number(b.qty ?? 0) : Number(a.qty ?? 0);
      return {
        id: r.id,
        item: a.item ?? '',
        color: a.color ?? '',
        size: a.size ?? '',
        qty: added,
        rack_qty: Number(a.qty ?? 0),   // what the rack held afterwards
        merged: !!b,
        rack_id: a.rack_id ?? '',
        module_type: a.module_type ?? null,
        module_id: a.module_id ?? null,
        user_id: r.user_id,
        created_at: r.created_at,
      };
    }));
  } catch (err) { next(err); }
});

// GET /api/history/picklists?limit= — every picklist generated, with whether
// its racks were ever updated.
router.get('/picklists', async (req, res, next) => {
  try {
    res.json(await listPicklists(req.org.id, clampLimit(req.query.limit)));
  } catch (err) { next(err); }
});

export default router;
