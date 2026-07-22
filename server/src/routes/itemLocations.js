import { Router } from 'express';
import { pool } from '../db.js';
import { addItem, updateItemQty, findPlacements } from '../services/rackService.js';

const router = Router();

// GET /api/item-locations/placements?item=&color=&size= — racks already holding this item
router.get('/placements', async (req, res, next) => {
  try {
    const { item, color = '', size = '' } = req.query;
    res.json(await findPlacements(pool, { item, color, size }));
  } catch (err) { next(err); }
});

// GET /api/item-locations — full stock listing (Inventory Report)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, item, color, size, qty, fk_rack_id AS rack_id, module_type, module_id, updated_at
       FROM item_location ORDER BY item, color, size`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/item-locations — add item to rack (Flow A or Flow B). SRS §3.1
router.post('/', async (req, res, next) => {
  try {
    const { rackId, item, color, size, qty, moduleType, moduleId } = req.body;
    const result = await addItem({ rackId, item, color, size, qty, moduleType, moduleId });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PATCH /api/item-locations/:id — update qty (0 removes). SRS §3.2
router.patch('/:id', async (req, res, next) => {
  try {
    const result = await updateItemQty({ id: Number(req.params.id), qty: req.body.qty });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
