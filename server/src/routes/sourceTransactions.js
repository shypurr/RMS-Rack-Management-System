import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../services/rackService.js';
import { MODULE_TYPES, fetchModuleTransactions, VastraRejection } from '../vastraClient.js';

const router = Router();

// Set USE_VASTRA_MODULES=true to read the four real Vastra source modules
// instead of the `source_transaction` stub table. Left off by default because
// the module endpoint paths are still unconfirmed (see vastraClient.js) and the
// whole demo dataset depends on the stub.
const USE_VASTRA = process.env.USE_VASTRA_MODULES === 'true';

// Live Vastra read, normalized in vastraClient to the same
// `{ id, module_type, item, color, size, qty }` shape the stub returns — so the
// client needs no changes either way.
async function fromVastra(org, { moduleType, q, limit }) {
  if (!org.vastra_access_token) {
    throw new HttpError(409, 'No Vastra session — log out and log back in.');
  }
  const types = moduleType ? [moduleType] : MODULE_TYPES;
  let rows;
  try {
    // `q` becomes Vastra's search_string — it filters server-side there, so we
    // must not also cap the result with `limit` (see below).
    const lists = await Promise.all(
      types.map((t) => fetchModuleTransactions(org.vastra_access_token, t, q || ''))
    );
    rows = lists.flat();
  } catch (err) {
    if (err instanceof VastraRejection) {
      // Token expired or revoked — drop ours so our state stays honest.
      await pool.query('UPDATE organization SET vastra_access_token = NULL WHERE id = ?', [org.id]);
      throw new HttpError(502, 'Vastra rejected the stored token — log out and log back in.');
    }
    console.error('Vastra source-module fetch failed:', err.message);
    throw new HttpError(502, 'Vastra source modules unavailable — please try again in a moment.');
  }
  // Same cap semantics as the stub query below: a search returns every match,
  // an empty box returns the latest `limit`. Vastra already applied the filter.
  return q ? rows : rows.slice(0, limit);
}

// GET /api/source-transactions?moduleType=&q=&limit= — feed for Flow A.
// No q → latest `limit` (default 10) transactions; with q → all id matches.
// "latest" = id-descending (the stub has no timestamp; Vastra defines its own order).
router.get('/', async (req, res, next) => {
  try {
    const { moduleType, q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    if (USE_VASTRA) return res.json(await fromVastra(req.org, { moduleType, q, limit }));

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
