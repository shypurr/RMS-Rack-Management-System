import { pool } from '../db.js';
import { HttpError } from './rackService.js';
import { MODULE_TYPES, fetchModuleTransactions, VastraRejection } from '../vastraClient.js';

// One place that answers "give me transaction rows for a module". Both the
// inbound feed (/api/source-transactions, Flow A) and the outbound picklist
// (/api/picklist, Flow C) read through here so the Vastra-vs-stub branching,
// the token handling and the cap semantics exist exactly once.

// Set USE_VASTRA_MODULES=true to read the real Vastra modules instead of the
// `source_transaction` stub table. Left off by default because the whole demo
// dataset depends on the stub — the live read itself is done (see vastraClient.js)
// and needs only a real api-key to switch on.
export const USE_VASTRA = process.env.USE_VASTRA_MODULES === 'true';

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

async function fromStub({ moduleType, q, limit }) {
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
  return rows;
}

// No moduleType → every INBOUND module (never the Delivery Challan); the
// picklist always passes its module explicitly.
export async function fetchTransactions(org, { moduleType, q, limit = 10 }) {
  if (USE_VASTRA) return fromVastra(org, { moduleType, q, limit });
  if (!moduleType) {
    // The stub table holds outbound challans too, so an unfiltered read has to
    // exclude them by hand — Vastra's fan-out above is already inbound-only.
    const rows = await fromStub({ q, limit: limit * 4 });
    const inbound = rows.filter((r) => MODULE_TYPES.includes(r.module_type));
    return q ? inbound : inbound.slice(0, limit);
  }
  return fromStub({ moduleType, q, limit });
}
