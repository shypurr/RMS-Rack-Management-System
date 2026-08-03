import { Router } from 'express';
import { fetchTransactions } from '../services/sourceModules.js';

const router = Router();

// GET /api/source-transactions?moduleType=&q=&limit= — feed for Flow A.
// No q → latest `limit` (default 10) transactions; with q → all id matches.
// "latest" = id-descending (the stub has no timestamp; Vastra defines its own order).
// Reads through services/sourceModules.js, which handles the Vastra-vs-stub
// branching (shared with the picklist route).
router.get('/', async (req, res, next) => {
  try {
    const { moduleType, q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    res.json(await fetchTransactions(req.org, { moduleType, q, limit }));
  } catch (err) { next(err); }
});

export default router;
