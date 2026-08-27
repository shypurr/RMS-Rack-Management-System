import { pool } from '../db.js';
import { HttpError } from './rackService.js';
import { MODULE_TYPES, PICK_MODULE_TYPE, fetchModuleTransactions, VastraRejection } from '../vastraClient.js';

// One place that answers "give me transaction rows for a module". Both the
// inbound feed (/api/source-transactions, Flow A) and the outbound picklist
// (/api/picklist, Flow C) read through here so the Vastra-vs-stub branching,
// the token handling and the cap semantics exist exactly once.

// Set USE_VASTRA_MODULES=true to read the real Vastra modules instead of the
// `source_transaction` stub table. Left off by default because the whole demo
// dataset depends on the stub — the live read itself is done (see vastraClient.js)
// and needs only a real api-key to switch on.
export const USE_VASTRA = process.env.USE_VASTRA_MODULES === 'true';

// The picklist normally follows USE_VASTRA_MODULES. Set USE_VASTRA_PICKLIST
// explicitly to split them — the point being to test picking against the
// sample challans from makeChallans.js while Add Item keeps reading live
// Vastra. Both flags are read at load, so changing one needs a restart.
const USE_VASTRA_PICK = process.env.USE_VASTRA_PICKLIST === undefined
  ? USE_VASTRA
  : process.env.USE_VASTRA_PICKLIST === 'true';

// Which rejections mean "this session is dead" rather than "I won't serve that
// module". Only these clear the stored token.
const AUTH_REJECTION = /token|unauthor|expire|session|login|forbidden|denied/i;

// Live Vastra read, normalized in vastraClient to the same
// `{ id, module_type, item, color, size, qty }` shape the stub returns — so the
// client needs no changes either way.
async function fromVastra(org, { moduleType, q, limit }) {
  // 401, not 409: a missing Vastra token means this login can no longer do
  // anything useful, and the only cure is a fresh OTP. The client treats 401
  // from ANY endpoint as "session gone" — it clears the stored token and sends
  // the user to /login. A 409 left them logged in and stuck forever.
  if (!org.vastra_access_token) {
    throw new HttpError(401, 'Vastra session expired — please log in again.');
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
      // Vastra answers `status:false` for everything it refuses, so an expired
      // token and a module it will not serve are indistinguishable at the
      // transport level. Clearing the session on the wrong one logs the org out
      // of EVERY module because one module misbehaved — so the destructive
      // branch needs positive evidence, not the benefit of the doubt.
      console.error(`Vastra rejected ${moduleType || 'all modules'}:`, err.code, err.message);
      if (AUTH_REJECTION.test(`${err.code} ${err.message}`)) {
        // Clearing the Vastra token alone used to leave the RMS session alive,
        // pointing at a NULL token — every later request 409'd with no way out
        // and no prompt to log in. Kill the session in the same breath so the
        // user is bounced to /login and the next OTP restores both.
        await pool.query('DELETE FROM session WHERE org_id = ?', [org.id]);
        await pool.query('UPDATE organization SET vastra_access_token = NULL WHERE id = ?', [org.id]);
        throw new HttpError(401, 'Vastra rejected the stored session — please log in again.');
      }
      // Not auth — surface Vastra's own words (safe to show) and keep the
      // session, so one bad module doesn't take the working ones down with it.
      throw new HttpError(502, `Vastra refused ${moduleType || 'the request'}: ${err.message}`);
    }
    console.error('Vastra source-module fetch failed:', err.message);
    throw new HttpError(502, 'Vastra source modules unavailable — please try again in a moment.');
  }
  // Same cap semantics as the stub query below: a search returns every match,
  // an empty box returns the latest `limit`. Vastra already applied the filter.
  return q ? rows : rows.slice(0, limit);
}

async function fromStub(orgId, { moduleType, q, limit }) {
  if (!orgId) throw new HttpError(500, 'fromStub requires an orgId');
  // The org predicate is never optional here — the stub table is shared by
  // every organization in the database.
  const where = ['fk_org_id = ?'];
  const params = [orgId];
  if (moduleType) { where.push('module_type = ?'); params.push(moduleType); }
  if (q) { where.push('id LIKE ?'); params.push(`%${q}%`); }
  const clause = `WHERE ${where.join(' AND ')}`;
  // With a search term, return every match; otherwise cap at `limit` latest.
  const cap = q ? '' : `LIMIT ${limit}`;
  // Aliased to `date` to match the live Vastra row shape, where the document
  // date arrives as `date` off the master. Formatted to a string rather than
  // handed over as a DATE: mysql2 would return a Date at local midnight, which
  // serializes back a day early in any timezone east of UTC.
  const [rows] = await pool.query(
    `SELECT *, DATE_FORMAT(doc_date, '%Y-%m-%d') AS \`date\`
     FROM source_transaction ${clause} ORDER BY id DESC ${cap}`,
    params
  );
  return rows;
}

// No moduleType → every INBOUND module (never the Delivery Challan); the
// picklist always passes its module explicitly, which is also how we know
// which of the two flags applies.
export async function fetchTransactions(org, { moduleType, q, limit = 10 }) {
  const live = moduleType === PICK_MODULE_TYPE ? USE_VASTRA_PICK : USE_VASTRA;
  // The live branch needs no org filter of its own: it reads with this org's
  // Vastra access token, so Vastra scopes the response. The stub branch is a
  // shared local table and must filter explicitly.
  if (live) return fromVastra(org, { moduleType, q, limit });
  if (!moduleType) {
    // The stub table holds outbound challans too, so an unfiltered read has to
    // exclude them by hand — Vastra's fan-out above is already inbound-only.
    const rows = await fromStub(org.id, { q, limit: limit * 4 });
    const inbound = rows.filter((r) => MODULE_TYPES.includes(r.module_type));
    return q ? inbound : inbound.slice(0, limit);
  }
  return fromStub(org.id, { moduleType, q, limit });
}
