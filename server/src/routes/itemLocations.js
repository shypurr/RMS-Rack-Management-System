import { Router } from 'express';
import { pool } from '../db.js';
import { addItem, findPlacements } from '../services/rackService.js';
import { getOrgWidths } from '../services/layoutService.js';
import { decorateRacks } from '../lib/rackCode.js';

const router = Router();

// GET /api/item-locations/placements?item=&color=&size= — racks already holding this item
router.get('/placements', async (req, res, next) => {
  try {
    const { item, color = '', size = '' } = req.query;
    res.json(await findPlacements(req.org.id, { item, color, size }));
  } catch (err) { next(err); }
});

// GET /api/item-locations — full stock listing (Inventory Report)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT il.id, il.item, il.color, il.size, il.qty, il.fk_rack_id,
              rm.rack_no, rm.shelf_no, rm.bin_no,
              il.module_type, il.module_id, il.updated_at
       FROM item_location il
       JOIN rack_master rm ON rm.id = il.fk_rack_id
       WHERE il.fk_org_id = ? ORDER BY il.item, il.color, il.size`,
      [req.org.id]
    );
    res.json(decorateRacks(rows, await getOrgWidths(req.org.id)));
  } catch (err) { next(err); }
});

// POST /api/item-locations — add item to rack (Flow A or Flow B). SRS §3.1
router.post('/', async (req, res, next) => {
  try {
    const { rackId, item, color, size, qty, moduleType, moduleId } = req.body;
    const result = await addItem(req.org.id, {
      rackId: Number(rackId), item, color, size, qty, moduleType, moduleId,
      userId: req.org.vastra_org_id,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PATCH /api/item-locations/:id is gone deliberately.
//
// It set a stored quantity to any number, and to 0 to delete the row. That is
// the one thing no screen is allowed to do: stock in a rack changes by Putaway
// (it arrived), by the Picklist (it left) or by Move Item (it went elsewhere),
// and each of those records WHY in the audit trail. A bare "set it to 7" records
// nothing, so a warehouse that drifts from its shelves has no history to explain
// how. Rack Management used to call this and no longer does.
//
// updateItemQty is still in rackService.js: a deliberate stock-correction flow
// (damage, shrinkage, a miscount found later) is a real need, and when it is
// built it should be its own endpoint with its own reason field — not this one
// quietly reopened.

export default router;
