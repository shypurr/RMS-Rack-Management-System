import { Router } from 'express';
import { pool } from '../db.js';
import { listRacks, getRackWithItems, HttpError } from '../services/rackService.js';

const router = Router();

// GET /api/racks — rack master list with used/available/status
router.get('/', async (req, res, next) => {
  try {
    res.json(await listRacks(pool));
  } catch (err) { next(err); }
});

// GET /api/racks/:id — one rack + its items (rack-wise report, SRS §3.4)
router.get('/:id', async (req, res, next) => {
  try {
    res.json(await getRackWithItems(pool, req.params.id));
  } catch (err) { next(err); }
});

// POST /api/racks — create/maintain a rack master row
router.post('/', async (req, res, next) => {
  try {
    const { rackId, capacity } = req.body;
    if (!rackId || !Number.isInteger(Number(capacity)) || Number(capacity) <= 0) {
      throw new HttpError(400, 'rackId and a positive integer capacity are required');
    }
    await pool.query(
      `INSERT INTO rack_master (rack_id, capacity, used, status) VALUES (?, ?, 0, 'Vacant')`,
      [rackId, Number(capacity)]
    );
    res.status(201).json({ rack_id: rackId, capacity: Number(capacity), used: 0, available: Number(capacity), status: 'Vacant' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return next(new HttpError(409, `Rack ${req.body.rackId} already exists`));
    next(err);
  }
});

export default router;
