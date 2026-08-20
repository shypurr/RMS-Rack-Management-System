// Dev tool: a stand-in for Vastra's API, so you can complete a real login
// locally without their staging server, a real OTP, or a real QR scan.
//
//   node devFakeVastra.js
//
// then point the server at it instead of staging:
//   VASTRA_API_BASE_URL=http://127.0.0.1:19999/api/v2
//
// This is NOT wired into the app — it is a separate process, and the only
// thing that selects it is that one environment variable. There is no "fake
// mode" flag inside RMS that could be left on by accident: point the variable
// back at staging and this is unreachable.
//
// It answers in Vastra's envelope, quirks included: always HTTP 200, with
// success/failure in the body. Everything RMS does with the response — the
// organization upsert, the session insert, the single-active-session rule — is
// the real code path, so a login through this is a genuine end-to-end test of
// everything except Vastra itself.

import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_VASTRA_PORT) || 19999;

// One fixed organization. `organization_Id` is what RMS matches on, so keeping
// it stable means repeated logins reuse the same row instead of piling up.
const ORG = {
  organization_Id: 999001,
  organization_name: 'Local Test Org',
  access_token: 'fake-local-access-token',
  org_url: 'http://localhost/fake',
};

// Staging echoes the OTP back in its message, so the fixed value here is in
// the same spirit — type it into the OTP form and it works.
const OTP = '1234';

const ok = (data) => ({ status: true, data });
const fail = (code, message) => ({ status: false, error: { code, message } });

function handle(path, body) {
  switch (path) {
    case '/api/v2/user/admin-user-verifyQRCode': {
      // The three fields the dev's spec sends. The topic length is the thing
      // most likely to be wrong, so it is checked loudly rather than ignored.
      const { mobile, topic, country_code } = body || {};
      if (!topic || topic.length !== 31) {
        return fail('INVALID_TOPIC', `topic must be 31 chars, got ${topic?.length ?? 0}`);
      }
      if (!topic.startsWith('$VASTRA@!QRCODE$')) {
        return fail('INVALID_TOPIC', 'topic must start with $VASTRA@!QRCODE$');
      }
      if (topic.includes('STOREQRCODE')) {
        return fail('INVALID_TOPIC', 'topic must NOT include the STOREQRCODE suffix');
      }
      if (!mobile) return fail('INVALID_MOBILE', 'mobile is required');
      console.log(`  ✓ QR verified for ${country_code || '?'} ${mobile}`);
      return ok(ORG);
    }

    // The OTP endpoints too, so the other tab is testable offline as well.
    case '/api/v2/user/loyalty-signup':
      return ok({ message: `OTP sent (use ${OTP})` });

    case '/api/v2/user/loyalty-verifyotp':
      if (String(body?.otp) !== OTP) return fail('INVALID_OTP', 'Incorrect OTP');
      return ok(ORG);

    default:
      return null;
  }
}

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      // fall through — handlers treat a null body as missing fields
    }
    const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
    console.log(`${req.method} ${path} ${raw || ''}`);

    const result = handle(path, body);
    if (!result) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: false, error: { message: 'no fake for this path' } }));
    }
    if (result.status === false) console.log(`  ✗ ${result.error.message}`);

    // Vastra answers 200 even on failure — reproduced deliberately, because
    // reading res.ok instead of body.status is the exact mistake this shape
    // is meant to catch.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  });
}).listen(PORT, () => {
  console.log(`Fake Vastra on http://127.0.0.1:${PORT}`);
  console.log(`  VASTRA_API_BASE_URL=http://127.0.0.1:${PORT}/api/v2`);
  console.log(`  org: ${ORG.organization_name} (${ORG.organization_Id}), OTP: ${OTP}\n`);
});
