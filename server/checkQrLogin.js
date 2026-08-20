// Self-test for the QR login protocol. No database, no broker, no network —
// `globalThis.fetch` is replaced, same as checkModules.js.
//
// What this locks in is the length contract from Vastra's spec. Their reference
// handler sends `topic.substr(0, 31)` to the verify API, and 31 is only correct
// because firstTopic is 16 characters and the random value is 15. Nothing at
// runtime would tell you that had drifted: Vastra would just answer "invalid
// QR" and the login would fail with no hint as to why.
//
//   node checkQrLogin.js

import assert from 'node:assert/strict';

process.env.VASTRA_API_BASE_URL = 'http://vastra.test/api/v2';
process.env.VASTRA_API_KEY = '1';
process.env.VASTRA_UDID = 'rms-backend';
process.env.VASTRA_DEVICE_TYPE = 'android';

const { verifyQrCode, VastraApiError, VastraRejection, QR_API_TOPIC_LENGTH } =
  await import('./src/vastraClient.js');
const { buildTopic, _internals } = await import('./src/services/qrLogin.js');

// ── fetch stub ────────────────────────────────────────────────────────────
const sent = [];
let reply = () => {
  throw new Error('no Vastra stub installed');
};

globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  sent.push({
    url: u,
    method: opts?.method,
    headers: opts?.headers || {},
    body: opts?.body ? JSON.parse(opts.body) : null,
  });
  return new Response(JSON.stringify(reply(u)), {
    status: 200, // Vastra always answers 200 and puts success/failure in the body.
    headers: { 'content-type': 'application/json' },
  });
};

const PROFILE = {
  organization_Id: 4821,
  organization_name: 'Shree Textiles',
  access_token: 'tok-qr-abc',
};

// ── (a) the length contract ───────────────────────────────────────────────
assert.equal(_internals.FIRST_TOPIC, '$VASTRA@!QRCODE$');
assert.equal(_internals.FIRST_TOPIC.length, 16, 'firstTopic must be 16 chars');
assert.equal(_internals.LAST_STORE_TOPIC, 'STOREQRCODE');
assert.equal(_internals.API_TOPIC_LENGTH, 31, '16 + 15 = 31, the substr the dev specified');

// The dev's generator relies on its trailing literal to guarantee the length:
// Math.random().toString(36) drops trailing zeros and can be as short as "0".
// If that literal is ever shortened, this catches it.
for (let i = 0; i < 50_000; i++) {
  assert.equal(_internals.makeValue().length, 15, 'QR value must always be 15 chars');
}

const value = _internals.makeValue();
const topic = buildTopic(value);
assert.equal(topic.length, 42, 'subscribe topic is 16 + 15 + 11');
assert.equal(topic.substr(0, 31), _internals.FIRST_TOPIC + value);
assert.equal(
  topic.substr(0, 31).includes('STOREQRCODE'),
  false,
  'the API topic must NOT carry the STOREQRCODE suffix'
);

// ── (b) the verify call ───────────────────────────────────────────────────
sent.length = 0;
reply = () => ({ status: true, data: PROFILE });

const apiTopic = topic.substr(0, QR_API_TOPIC_LENGTH);
let profile = await verifyQrCode('9876543210', apiTopic, '+91');

assert.equal(sent.length, 1);
assert.equal(sent[0].method, 'POST');
assert.equal(sent[0].url.pathname, '/api/v2/user/admin-user-verifyQRCode');
// Exactly the three fields the dev's formData carries — no more, no less.
assert.deepEqual(sent[0].body, {
  mobile: '9876543210',
  topic: apiTopic,
  country_code: '+91',
});
assert.equal(Object.keys(sent[0].body).length, 3);
assert.equal(sent[0].headers['api-key'], '1');
assert.equal(sent[0].headers.udid, 'rms-backend');
assert.equal(sent[0].headers['device-type'], 'android');
// This is a login endpoint — there is no token yet to send.
assert.equal(sent[0].headers.authorization, undefined);
assert.equal(profile.organization_Id, 4821);
assert.equal(profile.access_token, 'tok-qr-abc');

// ── (c) a wrong-length topic never reaches Vastra ─────────────────────────
sent.length = 0;
await assert.rejects(
  () => verifyQrCode('9876543210', topic, '+91'), // the full 42-char topic
  VastraApiError,
  'the full subscribe topic must be rejected, not sent'
);
assert.equal(sent.length, 0, 'no request may be made with a bad topic length');

// ── (d) Vastra refusing ───────────────────────────────────────────────────
reply = () => ({ status: false, error: { code: 'INVALID_QR', message: 'QR code expired' } });
await assert.rejects(() => verifyQrCode('9876543210', apiTopic, '+91'), (err) => {
  assert.ok(err instanceof VastraRejection);
  // Vastra's own wording is safe to show the user.
  assert.equal(err.message, 'QR code expired');
  return true;
});

// ── (e) a half-empty profile must never mint a session ────────────────────
// A session without an access_token would exist but be useless: every module
// read (Putaway, Picklist) would fail for it.
reply = () => ({ status: true, data: { organization_Id: 4821 } });
await assert.rejects(() => verifyQrCode('9876543210', apiTopic, '+91'), VastraApiError);

reply = () => ({ status: true, data: { access_token: 'tok-only' } });
await assert.rejects(() => verifyQrCode('9876543210', apiTopic, '+91'), VastraApiError);

// ── (f) an unrecognised envelope is not a success ─────────────────────────
reply = () => ({ status: 'true', data: PROFILE }); // string, not boolean
await assert.rejects(() => verifyQrCode('9876543210', apiTopic, '+91'), VastraApiError);

console.log('✓ checkQrLogin: topic contract, verify call, and every failure mode');
