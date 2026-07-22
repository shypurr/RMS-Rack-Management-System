import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/audit-log — change history (newest first)
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { action } = req.query; // optional filter: add | update | move | remove
    const [rows] = action
      ? await pool.query(
          `SELECT id, entity_type, entity_id, action, before_json, after_json, user_id, created_at
           FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT ?`,
          [action, limit]
        )
      : await pool.query(
          `SELECT id, entity_type, entity_id, action, before_json, after_json, user_id, created_at
           FROM audit_log ORDER BY id DESC LIMIT ?`,
          [limit]
        );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
