import { Router } from 'express';
import { pool } from '../db.js';
import { searchPicklists, getPicklist } from '../services/picklistStore.js';
import { HttpError } from '../lib/httpError.js';

const router = Router();

// Operational history for the two stock-moving flows, each read from where
// that flow actually records itself:
//   putaway  → audit_log (`add` rows), which is already written on every add
//   picklist → the picklist table, which also knows about picklists that were
//              generated and then never acted on — audit_log cannot, because
//              generating writes no audit row by design.
//
// Both endpoints search, filter by date and paginate ON THE SERVER. They used
// to hand the browser the latest 200 rows and let it filter those, which meant
// the 201st record was unreachable no matter what was typed — and the screen
// said "no records match" rather than "not loaded", so the ceiling was
// invisible. Anything older than the last 200 was effectively deleted as far
// as the user could tell.

const clampLimit = (v, fallback = 50) => Math.min(Math.max(Number(v) || fallback, 1), 200);
const clampOffset = (v) => Math.max(Number(v) || 0, 0);

// Dates arrive as YYYY-MM-DD from a date input. Anything else is ignored rather
// than passed to MySQL, so a malformed value narrows nothing instead of
// erroring the whole screen.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (v) => (DATE.test(String(v || '')) ? String(v) : null);

// The putaway filter, split out from the route so historySearch.check.mjs can
// assert its "?" count matches the parameters it binds. Exported for that
// reason alone.
export function putawayWhere(orgId, { q, from, to }) {
  const where = ['fk_org_id = ?', "entity_type = 'item_location'", "action = 'add'"];
  const params = [orgId];

  // created_at compared directly rather than through DATE(created_at), which
  // would make idx_audit_org_created unusable.
  if (from) { where.push('created_at >= ?'); params.push(`${from} 00:00:00`); }
  if (to) { where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`); }

  const term = String(q || '').trim();
  if (term) {
    // The searchable fields live inside after_json, so this cannot use an index
    // — it is a scan of this org's `add` rows, which the date filter above is
    // the practical way to keep small. Promoting them to real columns is the
    // fix if it ever gets slow.
    const paths = ['$.item', '$.color', '$.size', '$.rack_id', '$.module_id', '$.module_type'];
    where.push(`(${[
      ...paths.map(() => 'JSON_UNQUOTE(JSON_EXTRACT(after_json, ?)) LIKE ?'),
      'user_id LIKE ?',
    ].join(' OR ')})`);
    for (const path of paths) params.push(path, `%${term}%`);
    params.push(`%${term}%`);
  }

  return { clause: `WHERE ${where.join(' AND ')}`, params };
}

// GET /api/history/putaway — stock added to racks, newest first.
//   ?q=       item, colour, size, rack, module code or user
//   ?from=&to=  YYYY-MM-DD, inclusive both ends
//   ?limit=&offset=
router.get('/putaway', async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const from = asDate(req.query.from);
    const to = asDate(req.query.to);
    const q = String(req.query.q || '').trim();

    const { clause, params } = putawayWhere(req.org.id, { q, from, to });
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_log ${clause}`, params
    );
    const [rows] = await pool.query(
      `SELECT id, entity_id, before_json, after_json, user_id, created_at
       FROM audit_log ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      total: Number(total),
      rows: rows.map((r) => {
        const a = r.after_json || {};
        const b = r.before_json;
        // after_json holds the row AFTER the add, so when the add merged into an
        // existing row its qty is the running total, not what was put away.
        // The difference against before_json is the amount actually added.
        const added = b ? Number(a.qty ?? 0) - Number(b.qty ?? 0) : Number(a.qty ?? 0);
        return {
          id: r.id,
          item: a.item ?? '',
          color: a.color ?? '',
          size: a.size ?? '',
          qty: added,
          rack_qty: Number(a.qty ?? 0),   // what the rack held afterwards
          merged: !!b,
          rack_id: a.rack_id ?? '',
          module_type: a.module_type ?? null,
          module_id: a.module_id ?? null,
          user_id: r.user_id,
          created_at: r.created_at,
        };
      }),
    });
  } catch (err) { next(err); }
});

// GET /api/history/picklists — every picklist generated, with whether its racks
// were ever updated.
//   ?q=        challan no, #id, item, colour, size or user
//   ?from=&to= YYYY-MM-DD, inclusive both ends
//   ?status=   updated | pending
//   ?limit=&offset=
router.get('/picklists', async (req, res, next) => {
  try {
    res.json(await searchPicklists(req.org.id, {
      q: req.query.q,
      from: asDate(req.query.from),
      to: asDate(req.query.to),
      status: ['updated', 'pending'].includes(req.query.status) ? req.query.status : null,
      limit: clampLimit(req.query.limit),
      offset: clampOffset(req.query.offset),
    }));
  } catch (err) { next(err); }
});

// GET /api/history/picklists/:id — one stored picklist's lines, exactly as they
// were recorded. This is deliberately NOT /api/picklist/:id/resolve, which
// re-resolves against today's stock and refuses once the racks have been
// updated: history has to be readable forever, and has to show what the sheet
// actually said rather than where that stock sits now.
router.get('/picklists/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid picklist id');
    const picklist = await getPicklist(req.org.id, id);
    if (!picklist) throw new HttpError(404, 'Picklist not found');
    res.json(picklist);
  } catch (err) { next(err); }
});

export default router;
