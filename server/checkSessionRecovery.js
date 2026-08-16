// Self-check for what happens when Vastra stops accepting our stored token.
// No test framework — `node checkSessionRecovery.js`. Stubs the Vastra HTTP
// layer (real fetch still used for our own localhost API) and asserts:
//   (a) an auth-shaped rejection kills the RMS session too, answering 401 —
//       so the client's existing "401 → clear token → /login" path fires and
//       the user is told to log in instead of silently getting nothing
//   (b) the follow-up request is also 401, never the old dead-end 409 that
//       left a valid session pointing at a wiped token forever
//   (c) a NON-auth rejection still answers 502 and leaves BOTH the session and
//       the stored token alone — one module Vastra won't serve must not log the
//       org out of the four that work
// Plus a baseline that a working token still serves normalized rows, so a green
// run means "recovery works" AND "the happy path was not broken to get there".
// Needs a reachable MySQL; the whole file is skipped with a notice if it's down.
import 'dotenv/config';
import assert from 'node:assert/strict';

// Must be set before the modules read env at load — hence the dynamic imports.
// USE_VASTRA_MODULES=true is the whole point here: this file exercises the live
// Vastra read path, not the stub table.
const VASTRA_HOST = 'http://vastra.test';
process.env.VASTRA_API_BASE_URL = `${VASTRA_HOST}/api/v2`;
process.env.USE_VASTRA_MODULES = 'true';

const { pool, pingDb, applyAuthSchema } = await import('./src/db.js');
const { createApp } = await import('./src/app.js');

// Intercept only Vastra traffic; everything else (our own API) goes out for real.
const realFetch = globalThis.fetch;
let reply = () => { throw new Error('no Vastra stub installed'); };
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith(VASTRA_HOST)) {
    // Vastra always answers HTTP 200 and puts success/failure in the body.
    return new Response(JSON.stringify(reply()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(url, opts);
};

const ok = (label) => console.log(`  ✓ ${label}`);

const dbErr = await pingDb();
if (dbErr) {
  console.log(`  – skipped: database unreachable (${dbErr.code || 'ERROR'})`);
  process.exit(0);
}
await applyAuthSchema();

const ORG = 'checkrecovery-test-org';
const cleanup = () => pool.query('DELETE FROM organization WHERE vastra_org_id = ?', [ORG]);
await cleanup(); // sessions cascade

const server = createApp().listen(0);
const { port } = server.address();

// Fresh org + session via the real login path, so the fixture is built the same
// way production builds it. Returns the opaque RMS session token.
const login = async (accessToken) => {
  reply = () => ({
    status: true,
    data: {
      organization_Id: ORG,
      organization_name: 'Recovery Textiles',
      access_token: accessToken,
    },
  });
  const res = await realFetch(`http://127.0.0.1:${port}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ country_code: '+91', mobile: '9000000009', otp: '1234' }),
  });
  assert.equal(res.status, 200, `verify-otp returned ${res.status}`);
  return (await res.json()).token;
};

const getModule = (sessionToken, moduleType = 'Job Slip') =>
  realFetch(
    `http://127.0.0.1:${port}/api/source-transactions?moduleType=${encodeURIComponent(moduleType)}&limit=10`,
    { headers: { authorization: `Bearer ${sessionToken}` } }
  );

const orgRow = async () => {
  const [[row]] = await pool.query(
    'SELECT id, vastra_access_token FROM organization WHERE vastra_org_id = ?',
    [ORG]
  );
  return row;
};
const sessionCount = async (orgId) => {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS n FROM session WHERE org_id = ?',
    [orgId]
  );
  return row.n;
};

try {
  // ── (0) baseline: the happy path still reaches the panel ─────────────────
  // The whole point of the fix is that a WORKING token still works. If this
  // breaks, the modules are empty for a reason that has nothing to do with auth.
  let sessionToken = await login('token-live');
  let org = await orgRow();
  assert.equal(org.vastra_access_token, 'token-live');
  assert.equal(await sessionCount(org.id), 1, 'login should leave exactly one session');

  reply = () => ({
    status: true,
    page: {},
    data: [{
      masterID: 'pi-1', masterNo: 'PI-06', date: '2026-08-16T04:02:04.000Z', name: 'Manoj',
      designDetails: [{ itemName: 'Rayon Kurti', color_name: 'Blue', size_name: 'L', quantity: 40, rate: '', itemTypeID: 'a' }],
      materialDetails: [],
    }],
  });

  let res = await getModule(sessionToken, 'Purchase Inward');
  assert.equal(res.status, 200, 'a valid token must serve the module');
  const rows = await res.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'PI-06', 'the panel shows masterNo, not masterID');
  assert.equal(rows[0].module_type, 'Purchase Inward');
  assert.equal(rows[0].item, 'Rayon Kurti');
  assert.equal(rows[0].qty, 40);
  ok('happy path: a valid token serves normalized rows to the panel');

  // ── (a) auth-shaped rejection → 401 + session destroyed ──────────────────

  // The verbatim envelope the real Vastra returns for a token it won't accept
  // (confirmed against /rack-manager/basic-details).
  reply = () => ({ status: false, error: { code: 401, message: 'Unauthorized access' } });

  res = await getModule(sessionToken);
  assert.equal(res.status, 401, 'a rejected Vastra token must answer 401, not 502');
  const body = await res.json();
  assert.match(body.error, /log in/i, 'the message must tell the user to log in again');

  org = await orgRow();
  assert.equal(org.vastra_access_token, null, 'the dead Vastra token must be cleared');
  assert.equal(await sessionCount(org.id), 0, 'the RMS session must die with the Vastra token');
  ok('auth-shaped rejection → 401, Vastra token cleared, RMS session destroyed');

  // ── (b) the follow-up request must not be the old dead-end 409 ───────────
  res = await getModule(sessionToken);
  assert.equal(res.status, 401, 'the next request must be 401 (client redirects to /login)');
  assert.notEqual(res.status, 409, 'a 409 here is the stuck state this check exists to prevent');
  ok('follow-up request is 401, never the stuck 409');

  // ── (c) a non-auth rejection must change nothing ─────────────────────────
  // Vastra answers status:false for everything it refuses, so "module not
  // enabled" and "token expired" look identical at the transport level. Only
  // the auth-shaped one may be destructive.
  sessionToken = await login('token-live-2');
  org = await orgRow();
  assert.equal(org.vastra_access_token, 'token-live-2');

  reply = () => ({ status: false, error: { code: 22001, message: 'Module not enabled for this organization' } });

  res = await getModule(sessionToken, 'Pack Design');
  assert.equal(res.status, 502, 'a non-auth refusal is an upstream fault, not a login problem');

  org = await orgRow();
  assert.equal(org.vastra_access_token, 'token-live-2', 'a non-auth refusal must NOT clear the token');
  assert.equal(await sessionCount(org.id), 1, 'a non-auth refusal must NOT kill the session');

  // And the session still works for everything else.
  const me = await realFetch(`http://127.0.0.1:${port}/api/auth/me`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(me.status, 200, 'the session must survive a module Vastra will not serve');
  ok('non-auth refusal → 502, token and session both left intact');

  console.log('\nAll session-recovery checks passed.');
} finally {
  await cleanup();
  server.close();
  await pool.end();
}
