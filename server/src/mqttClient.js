import 'dotenv/config';
import mqtt from 'mqtt';

// The MQTT half of Vastra's QR login. Vastra's server publishes the scan and
// approval events for a login attempt onto a per-attempt topic; this module
// owns the single broker connection and hands messages to services/qrLogin.js.
//
// This runs in Node, not the browser. Vastra gave us a plain TCP socket
// (mqtt://host:1883) and a browser has no TCP API at all — mqtt.js in a page
// can only speak ws://. Node has no such limit, so the same protocol works
// unchanged against the credentials we already have.

const URL_ = process.env.MQTT_URL || '';
const USERNAME = process.env.MQTT_USERNAME || undefined;
const PASSWORD = process.env.MQTT_PASSWORD || undefined;
const CONNECT_TIMEOUT = Number(process.env.MQTT_CONNECT_TIMEOUT) || 10000;

// Same fail-closed discipline as vastraClient.js: no fallback broker URL, so an
// unset MQTT_URL produces a clear error instead of dialling someone else's host.
export const mqttConfigured = () => Boolean(URL_);

// topic -> handler. Doubles as the re-subscribe list after a reconnect, and as
// the exact-match filter for incoming messages — mirroring the dev's
// `if (topic === this.topicString)` guard.
const handlers = new Map();

let client = null;

function connect() {
  if (client) return client;
  if (!URL_) throw new Error('MQTT_URL is not configured');

  client = mqtt.connect(URL_, {
    username: USERNAME,
    password: PASSWORD,
    connectTimeout: CONNECT_TIMEOUT,
    reconnectPeriod: 5000,
    // Unique per process: brokers disconnect the older client when two connect
    // with the same id, which would look like a random dropped subscription.
    clientId: `rms-${process.pid}-${Math.random().toString(16).slice(2, 10)}`,
  });

  client.on('connect', () => {
    console.log(`MQTT connected: ${redactedUrl()}`);
    // A clean session starts empty, so a reconnect mid-login would silently
    // stop delivering. Re-subscribe everything still in flight.
    for (const topic of handlers.keys()) {
      client.subscribe(topic, (err) => {
        if (err) console.error(`MQTT re-subscribe failed for ${topic}:`, err.message);
      });
    }
  });

  client.on('message', (topic, payload) => {
    const handler = handlers.get(topic);
    if (!handler) return; // not a topic we are waiting on — ignore
    try {
      handler(payload);
    } catch (err) {
      console.error(`MQTT handler threw for ${topic}:`, err.message);
    }
  });

  // Errors here are transport-level (auth rejected, host unreachable). mqtt.js
  // keeps retrying on its own; log and let it. Without this listener the
  // 'error' event would be unhandled and take the process down.
  client.on('error', (err) => {
    console.error(`MQTT error (${redactedUrl()}):`, err.message);
    explainSchemeMismatch(err);
  });
  client.on('close', () => console.warn('MQTT connection closed — reconnecting'));

  return client;
}

// Vastra documents their broker as `tcp://13.235.138.204:1884`, but 1884 is a
// WebSocket listener — raw TCP there gets an HTTP response, which mqtt.js tries
// to parse as an MQTT packet and reports as a malformed-packet error. The raw
// error names neither the URL nor the fix, so translate it once here rather
// than let the next person lose an afternoon to it.
let schemeHintShown = false;
function explainSchemeMismatch(err) {
  if (schemeHintShown) return; // reconnects would repeat this every few seconds
  const looksLikeHttpReply = /Invalid header flag bits|Invalid supported/i.test(err?.message || '');
  const usingRawTcp = /^(tcp|mqtt):/i.test(URL_);
  if (!looksLikeHttpReply || !usingRawTcp) return;
  schemeHintShown = true;
  console.error('    ↳ That port speaks WebSocket, not raw TCP. In server/.env change');
  console.error(`      MQTT_URL=${URL_}`);
  console.error(`      to      ${URL_.replace(/^(tcp|mqtt):/i, 'ws:')}`);
  console.error('      (or use the raw-TCP listener on port 1883 — same message bus)');
}

// Host only — MQTT_URL can carry credentials in its userinfo section.
function redactedUrl() {
  try {
    const u = new URL(URL_);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'mqtt broker';
  }
}

export function subscribe(topic, handler) {
  const c = connect();
  handlers.set(topic, handler);
  return new Promise((resolve, reject) => {
    c.subscribe(topic, (err) => {
      if (err) {
        handlers.delete(topic);
        return reject(new Error(`Could not subscribe to the QR topic: ${err.message}`));
      }
      resolve();
    });
  });
}

export function unsubscribe(topic) {
  handlers.delete(topic);
  if (client) client.unsubscribe(topic, (err) => {
    if (err) console.error(`MQTT unsubscribe failed for ${topic}:`, err.message);
  });
}

// Boot probe, mirroring pingDb(). Returns null on success, else the error, so
// index.js can warn loudly without refusing to start.
export function pingMqtt() {
  return new Promise((resolve) => {
    if (!URL_) return resolve(new Error('MQTT_URL is not set'));
    let c;
    try {
      c = connect();
    } catch (err) {
      return resolve(err);
    }
    if (c.connected) return resolve(null);
    const timer = setTimeout(() => {
      c.removeListener('connect', ok);
      resolve(new Error(`no connection within ${CONNECT_TIMEOUT}ms`));
    }, CONNECT_TIMEOUT);
    const ok = () => {
      clearTimeout(timer);
      resolve(null);
    };
    c.once('connect', ok);
  });
}

export const mqttTarget = redactedUrl;
