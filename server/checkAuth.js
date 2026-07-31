// Self-check for the Vastra login path. No test framework — `node checkAuth.js`.
// Stubs the Vastra HTTP layer (real fetch still used for our own localhost API)
// and asserts:
//   (a) a status:false envelope becomes a VastraRejection with Vastra's code+message
//   (b) verify-otp on a known vastra_org_id UPDATEs the row and rotates the
//       token instead of inserting a duplicate
//   (c) a second login deletes the first session token
// (b)/(c) need a reachable MySQL; they are skipped with a notice if it's down.
import 'dotenv/config';
import assert from 'node:assert/strict';

// Must be set before vastraClient.js reads env at module load — hence the
// dynamic imports below.
const VASTRA_HOST = 'http://vastra.test';
process.env.VASTRA_API_BASE_URL = `${VASTRA_HOST}/api/v2`;
process.env.USE_VASTRA_MODULES = 'false';

const { VastraRejection, verifyLoginOtp } = await import('./src/vastraClient.js');
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

// ── (a) rejection envelope → VastraRejection ──────────────────────────────
reply = () => ({ status: false, error: { code: 21014, message: 'Invalid OTP' } });
await assert.rejects(
  () => verifyLoginOtp('+91', '9000000001', '0000'),
  (err) =>
    err instanceof VastraRejection && err.code === 21014 && err.message === 'Invalid OTP'
);
ok('status:false envelope → VastraRejection carrying Vastra\'s code + message');

// ── (b) + (c) need the database ───────────────────────────────────────────
const dbErr = await pingDb();
if (dbErr) {
  console.log(`  – skipped DB checks: database unreachable (${dbErr.code || 'ERROR'})`);
  process.exit(0);
}
await applyAuthSchema();

const ORG = 'checkauth-test-org';
const cleanup = () => pool.query('DELETE FROM organization WHERE vastra_org_id = ?', [ORG]);
await cleanup(); // sessions cascade

const server = createApp().listen(0);
const { port } = server.address();

const login = async (mobile, profile) => {
  reply = () => ({ status: true, data: profile });
  const res = await realFetch(`http://127.0.0.1:${port}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ country_code: '+91', mobile, otp: '1234' }),
  });
  assert.equal(res.status, 200, `verify-otp returned ${res.status}`);
  return res.json();
};

try {
  const first = await login('9000000001', {
    organization_Id: ORG,
    organization_name: 'Check Textiles',
    access_token: 'token-one',
  });
  assert.ok(first.token && first.org?.name === 'Check Textiles');
  // The Vastra access_token must never reach the client.
  assert.equal(JSON.stringify(first).includes('token-one'), false);
  ok('first login creates the org, returns a session token, leaks no Vastra token');

  const second = await login('9000000002', {
    organization_Id: ORG,
    organization_name: 'Check Textiles Renamed',
    access_token: 'token-two',
  });

  const [orgs] = await pool.query(
    'SELECT id, name, mobile, vastra_access_token FROM organization WHERE vastra_org_id = ?',
    [ORG]
  );
  assert.equal(orgs.length, 1, 'second login must UPDATE, not INSERT a duplicate');
  assert.equal(orgs[0].name, 'Check Textiles Renamed');
  assert.equal(orgs[0].mobile, '9000000002');
  assert.equal(orgs[0].vastra_access_token, 'token-two', 'stored Vastra token must rotate');
  ok('second login updates the existing row and rotates the Vastra token');

  const [sessions] = await pool.query('SELECT token FROM session WHERE org_id = ?', [orgs[0].id]);
  assert.equal(sessions.length, 1, 'only one active session per org');
  assert.equal(sessions[0].token, second.token);
  assert.notEqual(first.token, second.token);
  const stale = await realFetch(`http://127.0.0.1:${port}/api/auth/me`, {
    headers: { authorization: `Bearer ${first.token}` },
  });
  assert.equal(stale.status, 401, 'the first token must no longer authenticate');
  ok('second login deletes the first session token');

  console.log('\nAll auth checks passed.');
} finally {
  await cleanup();
  server.close();
  await pool.end();
}
