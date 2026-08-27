import { Router } from 'express';
import { listRacks, getRackWithItems } from '../services/rackService.js';

const router = Router();

// GET /api/racks — this organization's bins with used/available/status
router.get('/', async (req, res, next) => {
  try {
    res.json(await listRacks(req.org.id));
  } catch (err) { next(err); }
});

// GET /api/racks/:id — one bin + its items (rack-wise report, SRS §3.4).
// `:id` is the numeric rack_master.id, not the display code: codes re-pad when
// the organization grows, so they cannot address a row.
router.get('/:id', async (req, res, next) => {
  try {
    res.json(await getRackWithItems(req.org.id, Number(req.params.id)));
  } catch (err) { next(err); }
});

// Racks are no longer created one at a time — they are generated from the
// organization's layout at /api/layout/apply. POST /api/racks is gone
// deliberately; a lone rack outside the configured grid would be invisible to
// the next layout change and then silently deleted by it.

export default router;
