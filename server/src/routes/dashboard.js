import { Router } from 'express';
import { getDashboard } from '../services/dashboardService.js';

const router = Router();

// GET /api/dashboard — one aggregation call for all dashboard widgets
router.get('/', async (req, res, next) => {
  try {
    res.json(await getDashboard(req.org.id));
  } catch (err) { next(err); }
});

export default router;
