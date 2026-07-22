import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/source-transactions?moduleType=&q=&limit= — stub feed for Flow A.
// No q → latest `limit` (default 10) transactions; with q → all id matches.
// "latest" = id-descending (stub has no timestamp; real Vastra API defines its own order).
router.get('/', async (req, res, next) => {
  try {
    const { moduleType, q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const where = [];
    const params = [];
    if (moduleType) { where.push('module_type = ?'); params.push(moduleType); }
    if (q) { where.push('id LIKE ?'); params.push(`%${q}%`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // With a search term, return every match; otherwise cap at `limit` latest.
    const cap = q ? '' : `LIMIT ${limit}`;
    const [rows] = await pool.query(
      `SELECT * FROM source_transaction ${clause} ORDER BY id DESC ${cap}`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
