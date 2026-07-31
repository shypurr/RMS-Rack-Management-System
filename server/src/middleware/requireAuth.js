import { pool } from '../db.js';
import { HttpError } from '../services/rackService.js';

// Session gate for every /api route except /api/health and /api/auth.
// Attaches req.org = { id, vastra_org_id, name, vastra_access_token }.
export async function requireAuth(req, res, next) {
  try {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new HttpError(401, 'Login required');

    const [rows] = await pool.query(
      `SELECT o.id, o.vastra_org_id, o.name, o.vastra_access_token, o.blocked
       FROM session s JOIN organization o ON o.id = s.org_id
       WHERE s.token = ?`,
      [token]
    );
    if (!rows.length) throw new HttpError(401, 'Session expired — please log in again');
    // Checked per request, so flipping `blocked` in the DB logs an org out on
    // its very next call.
    if (rows[0].blocked) throw new HttpError(403, 'Account is blocked');

    const { blocked, ...org } = rows[0];
    req.org = org;
    next();
  } catch (err) {
    next(err);
  }
}
