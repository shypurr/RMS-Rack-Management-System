import 'dotenv/config';

// The only module in RMS that talks to Vastra. Node 18+ global fetch, no axios.
//
// Two things the Vastra API does differently from most REST APIs:
//   1. Every endpoint answers HTTP 200 and puts success/failure in the body.
//      Read `status`, never the HTTP status code.
//   2. The `authorization` header takes the RAW access_token — no "Bearer " prefix.

// Config read at module load, same style as db.js. No fallback URL: with
// VASTRA_API_BASE_URL unset, every call fails closed instead of hitting a
// hardcoded host that may belong to someone else.
const BASE_URL = process.env.VASTRA_API_BASE_URL || '';
const API_KEY = process.env.VASTRA_API_KEY || '';
const TIMEOUT = Number(process.env.VASTRA_API_TIMEOUT) || 10000;
const UDID = process.env.VASTRA_UDID || 'rms-backend';
const DEVICE_TYPE = process.env.VASTRA_DEVICE_TYPE || 'android';

// Transport failure, timeout, missing config, unrecognized envelope → 502.
// The message can embed the internal Vastra host/IP, so it is for logs only.
export class VastraApiError extends Error {}

// Vastra answered and refused (bad OTP, unknown mobile, expired token).
// Carries Vastra's own code + message, which are safe to show the user → 401/403.
export class VastraRejection extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function call(method, path, { json, accessToken, raw = false } = {}) {
  if (!BASE_URL) throw new VastraApiError('VASTRA_API_BASE_URL is not configured');

  const headers = { 'api-key': API_KEY, udid: UDID, 'device-type': DEVICE_TYPE };
  if (json) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = accessToken; // RAW — no "Bearer "

  let body;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    body = await res.json();
  } catch (err) {
    throw new VastraApiError(`${method} ${path} failed: ${err.message}`);
  }

  // `raw` keeps the whole envelope — basic-details needs the sibling `page`
  // block for pagination, which sits next to `data`, not inside it.
  if (body?.status === true) return raw ? body : body.data;
  if (body?.status === false) {
    throw new VastraRejection(body.error?.code, body.error?.message || 'Vastra rejected the request');
  }
  throw new VastraApiError(`${method} ${path}: unrecognized response shape`);
}

// Step 1 of login — Vastra texts an OTP. Returns its confirmation message
// (staging echoes the OTP inside it).
export async function sendLoginOtp(countryCode, mobile, isResend = 0) {
  const data = await call('POST', '/user/loyalty-signup', {
    json: { country_code: countryCode, mobile, is_resend: isResend },
  });
  return data?.message || 'OTP sent';
}

// Step 2 — returns the org profile: organization_Id, organization_name,
// org_url, access_token. A half-empty profile must never create a session.
export async function verifyLoginOtp(countryCode, mobile, otp) {
  const data = await call('POST', '/user/loyalty-verifyotp', {
    json: { country_code: countryCode, mobile, otp },
  });
  if (!data?.organization_Id || !data?.access_token) {
    throw new VastraApiError('loyalty-verifyotp returned no organization_Id/access_token');
  }
  return data;
}

// ── QR login ──────────────────────────────────────────────────────────────
// Step 3 of the QR flow, and the only part of it that carries credentials. The
// MQTT approval message is just a doorbell: it says "this mobile approved that
// topic" and nothing more. This call is what Vastra actually authenticates —
// it only succeeds because Vastra's own server already recorded the approval.
//
// `topic` must be the 31-character prefix (firstTopic + value), NOT the full
// 42-character subscribe topic. services/qrLogin.js does that slice; the length
// check here is a backstop, since a wrong-length topic is otherwise a confusing
// "invalid QR" from Vastra with no hint as to why.
export const QR_API_TOPIC_LENGTH = 31;

export async function verifyQrCode(mobile, topic, countryCode) {
  if (String(topic).length !== QR_API_TOPIC_LENGTH) {
    throw new VastraApiError(
      `admin-user-verifyQRCode needs a ${QR_API_TOPIC_LENGTH}-char topic, got ${String(topic).length}`
    );
  }
  const data = await call('POST', '/user/admin-user-verifyQRCode', {
    json: { mobile, topic, country_code: countryCode },
  });
  // Same guard as verifyLoginOtp: a half-empty profile must never create a
  // session. Without access_token the session would exist but every module
  // read (Putaway, Picklist) would fail for it.
  if (!data?.organization_Id || !data?.access_token) {
    throw new VastraApiError('admin-user-verifyQRCode returned no organization_Id/access_token');
  }
  return data;
}

// ── source modules (Flow A) ───────────────────────────────────────────────
// Inbound only — these four feed putaway (Add Item) and the no-moduleType
// fan-out in /api/source-transactions. Delivery Challan is deliberately NOT
// here: it is outbound, and putaway must never offer it.
export const MODULE_TYPES = ['Purchase Inward', 'Job Slip', 'Pack Design', 'Sales Return'];

// Outbound (Flow C) — the picklist reads this one module and nothing else.
export const PICK_MODULE_TYPE = 'Delivery Challan';

// All four modules are ONE endpoint discriminated by a numeric moduleType —
// same handler, same response envelope, so one normalizer covers everything.
//   GET /rack-manager/basic-details?moduleType=1&search_string=Job19
// The doc writes the separator as `&?search_string=`; that is a typo in the doc
// (a literal `?` mid-query), not something to reproduce.
// NOTE: the dev-supplied path `/rekManager/basic-details` 404s — `rack-manager`
// is the one that resolves.
const BASIC_DETAILS = '/rack-manager/basic-details';

// Vastra calls #2 "Order Return"; RMS has always called it "Sales Return".
// Treated as the same module (its example row is SGR-12 with a customerOrgID).
const MODULE_IDS = {
  'Job Slip': 1,
  'Sales Return': 2,
  'Purchase Inward': 3,
  'Pack Design': 4,
  [PICK_MODULE_TYPE]: 5, // Delivery Challan — outbound, picklist only
};

// Stop runaway paging if Vastra ever returns a self-referential `next`.
const MAX_PAGES = 20;

// A master document carries two detail arrays: designDetails (the goods) and
// materialDetails (raw material consumed). Both describe physically rackable
// stock, so both are flattened into rows and tagged with `detail_kind` — the
// caller can drop one kind without another round trip.
function flatten(master, moduleType) {
  const base = {
    module_type: moduleType,
    master_id: String(master.masterID ?? ''),
    date: master.date ?? null,
    party: master.name ?? '',
  };
  const lines = [
    ...(master.designDetails || []).map((d) => ({ d, kind: 'design' })),
    ...(master.materialDetails || []).map((d) => ({ d, kind: 'material' })),
  ];
  return lines.map(({ d, kind }, i) => ({
    ...base,
    // What the user searches and sees, e.g. "JOB-92" — masterNo, not masterID.
    id: String(master.masterNo ?? master.masterID ?? ''),
    // Unique per line; `id` alone repeats across a multi-line document.
    line_id: `${master.masterID ?? master.masterNo}:${kind}:${i}`,
    detail_kind: kind,
    item: d.itemName ?? '',
    color: d.color_name ?? '',
    size: d.size_name ?? '',
    qty: Number(d.quantity ?? 0),
    rate: d.rate === '' || d.rate == null ? null : Number(d.rate),
    item_type_id: d.itemTypeID ?? '',
  }));
}

// Pending transactions for one module, flattened to the
// `{ id, module_type, item, color, size, qty, … }` row shape the client already
// consumes. `search` maps to Vastra's search_string; omitted when browsing.
export async function fetchModuleTransactions(accessToken, moduleType, search = '') {
  const moduleId = MODULE_IDS[moduleType];
  if (!moduleId) {
    throw new VastraApiError(`Unknown module "${moduleType}"`);
  }

  const params = new URLSearchParams({ moduleType: String(moduleId) });
  if (search) params.set('search_string', search);

  const rows = [];
  let path = `${BASIC_DETAILS}?${params}`;
  for (let page = 0; page < MAX_PAGES && path; page++) {
    const body = await call('GET', path, { accessToken, raw: true });
    for (const master of body.data || []) rows.push(...flatten(master, moduleType));
    // `page.next` comes back as a ready-made path; absent on the last page.
    const next = body.page?.next;
    path = next && next !== path ? next : null;
  }
  return rows;
}
