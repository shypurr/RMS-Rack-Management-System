import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { subscribe, unsubscribe, mqttConfigured } from '../mqttClient.js';
import { verifyQrCode, VastraApiError, VastraRejection } from '../vastraClient.js';
import { establishSession } from './session.js';

// Vastra's QR login, implemented exactly as their dev specified it.
//
//   1. Generate a random value, display it in the QR, subscribe to the topic
//      derived from it.
//   2. The mobile app scans the QR and posts it to Vastra for verification.
//   3. Vastra publishes the result onto that topic.
//   4. On `makeRequest`, call admin-user-verifyQRCode to get the auth state.
//   5. Save the auth state, unsubscribe.
//
// The one addition is step 6: RMS mints its own session row from the returned
// profile. Without it the browser would hold a Vastra auth state that
// middleware/requireAuth.js knows nothing about, and every /api call would 401.

// ── the dev's topic contract ──────────────────────────────────────────────
// firstTopic (16) + value (15) = 31, and the verify API is given exactly that
// 31-char prefix — `topic.substr(0, 31)` in their reference handler. The
// lengths are load-bearing: a value that is not 15 characters slices the wrong
// bytes and Vastra cannot match the topic.
const FIRST_TOPIC = '$VASTRA@!QRCODE$';
const LAST_STORE_TOPIC = 'STOREQRCODE';
const API_TOPIC_LENGTH = 31;
const VALUE_LENGTH = 15;

const DEFAULT_COUNTRY_CODE = process.env.VASTRA_DEFAULT_COUNTRY_CODE || '+91';
const TTL_MS = Number(process.env.QR_LOGIN_TTL_MS) || 120000;

// The dev's generator, verbatim. The 20-char literal on the end is what makes
// the length safe: Math.random().toString(36) drops trailing zeros and can be
// as short as "0", but "0" + "0" + 20 chars still leaves slice(2, 17) exactly
// 15 characters. Not padding for looks — it is the guarantee.
function makeValue() {
  return (
    Math.random().toString(36) +
    Math.random().toString(36) +
    'ZadGeSqDgASerdfaSefD'
  ).slice(2, 17);
}

export function buildTopic(value) {
  return FIRST_TOPIC + value + LAST_STORE_TOPIC;
}

// ── attempt store ─────────────────────────────────────────────────────────
// In memory, not a table. An attempt lives ~2 minutes, and the MQTT
// subscription is bound to this process anyway — so a shared table would not
// actually let a second instance serve the poll for an attempt it never
// subscribed to. Same trade-off (and same caveat) as the rate limiter in
// routes/auth.js: revisit if RMS ever runs multiple instances.
const attempts = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, a] of attempts) {
    if (now > a.expiresAt + 60000) {
      if (!a.settled) unsubscribe(a.topic);
      attempts.delete(id);
    }
  }
}

export function startAttempt() {
  sweep();
  if (!mqttConfigured()) {
    throw new VastraApiError('MQTT_URL is not configured — QR login is unavailable');
  }

  const value = makeValue();
  if (value.length !== VALUE_LENGTH) {
    // Unreachable given the literal above, but the whole protocol hangs off
    // this number, so it fails loudly rather than producing a broken topic.
    throw new VastraApiError(`QR value must be ${VALUE_LENGTH} chars, got ${value.length}`);
  }

  const attempt = {
    id: randomBytes(16).toString('hex'),
    // The QR itself is public — anyone can photograph it off the screen. The
    // poll secret never leaves the browser that started the attempt, so a
    // stolen QR image alone cannot collect the resulting session.
    pollSecret: randomBytes(32).toString('hex'),
    value,
    topic: buildTopic(value),
    status: 'pending',
    expiresAt: Date.now() + TTL_MS,
    session: null,
    error: null,
    settled: false,
  };

  attempts.set(attempt.id, attempt);
  // Not a secret — it is literally on screen in the QR — and it is the one
  // thing you need to drive the flow by hand with devPublishQr.js, or to tell
  // whether Vastra published to the topic we are actually listening on.
  console.log(`QR login attempt: ${attempt.topic}`);
  // Subscribe BEFORE the value ever reaches the browser. If the QR rendered
  // first, a fast scan could publish into a topic nobody is listening on and
  // the login would hang until it expired.
  return subscribe(attempt.topic, (payload) => onMessage(attempt, payload))
    .then(() => attempt)
    .catch((err) => {
      attempts.delete(attempt.id);
      throw err;
    });
}

function settle(attempt, status, patch = {}) {
  attempt.status = status;
  Object.assign(attempt, patch);
  attempt.settled = true;
  unsubscribe(attempt.topic);
}

// The dev's message handler. Their two checks are independent ifs, not
// else-if, so one message carrying both flags is valid and both branches run.
async function onMessage(attempt, payload) {
  let response;
  try {
    response = JSON.parse(payload.toString());
  } catch {
    console.error('QR login: unparseable MQTT payload');
    return;
  }

  if (response.status === true && response.isVerified === true) {
    // Progress signal only — no credentials here. It exists so the portal can
    // stop showing a dead QR and say "confirm on your phone".
    if (attempt.status === 'pending') attempt.status = 'scanned';
  }

  if (response.status === true && response.makeRequest === true) {
    // Vastra may publish more than once; the verify call is single-use, so a
    // second delivery must not fire it again.
    if (attempt.status === 'verifying' || attempt.settled) return;
    attempt.status = 'verifying';

    const formData = {
      mobile: response.mobile,
      topic: attempt.topic.substr(0, API_TOPIC_LENGTH),
      country_code: response.country_code || DEFAULT_COUNTRY_CODE,
    };

    try {
      const profile = await verifyQrCode(formData.mobile, formData.topic, formData.country_code);
      const session = await establishSession(profile, formData.mobile);
      settle(attempt, 'approved', { session });
    } catch (err) {
      // Vastra's own refusal is safe to show; a transport error's text can
      // embed the internal Vastra host, so it goes to the log only. Same split
      // routes/auth.js already applies.
      if (err instanceof VastraRejection) {
        settle(attempt, 'error', { error: err.message });
      } else {
        console.error('QR login verification failed:', err.message);
        settle(attempt, 'error', { error: 'Could not complete the QR sign-in. Please try again.' });
      }
    }
  }
}

// What the browser's poll sees. Reading an approved attempt hands the session
// over exactly once — after that the attempt is gone, so a replayed poll (or a
// leaked secret used later) gets nothing.
export function readAttempt(id, secret) {
  sweep();
  const attempt = attempts.get(id);
  if (!attempt) return { status: 'unknown' };
  // Compared before anything else is revealed, so a wrong secret cannot even be
  // used to watch another attempt's progress.
  if (attempt.pollSecret !== secret) return { status: 'unknown' };

  if (attempt.status === 'approved') {
    attempts.delete(id);
    return { status: 'approved', ...attempt.session };
  }
  if (attempt.status === 'error') {
    attempts.delete(id);
    return { status: 'error', error: attempt.error };
  }
  if (Date.now() > attempt.expiresAt) {
    if (!attempt.settled) unsubscribe(attempt.topic);
    attempts.delete(id);
    return { status: 'expired' };
  }
  // 'verifying' is reported as 'scanned': both mean "we are working on it", and
  // the client has no separate UI for the split second in between.
  return { status: attempt.status === 'verifying' ? 'scanned' : attempt.status };
}

export function cancelAttempt(id, secret) {
  const attempt = attempts.get(id);
  if (!attempt || attempt.pollSecret !== secret) return;
  if (!attempt.settled) unsubscribe(attempt.topic);
  attempts.delete(id);
}

// Exported for checkQrLogin.js — the length contract is the whole protocol.
export const _internals = { FIRST_TOPIC, LAST_STORE_TOPIC, API_TOPIC_LENGTH, VALUE_LENGTH, makeValue };
