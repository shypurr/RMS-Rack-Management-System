import { Router } from 'express';
import { moveItem } from '../services/rackService.js';

const router = Router();

// POST /api/moves — move qty of an item to another rack, atomically. SRS §3.3
router.post('/', async (req, res, next) => {
  try {
    const { itemId, toRackId, qty } = req.body;
    const result = await moveItem({ itemId: Number(itemId), toRackId, qty });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
