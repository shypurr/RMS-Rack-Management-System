// Dev tool: stand in for Vastra's server and publish the two QR-login messages
// by hand. Lets you exercise the whole flow before Vastra hands over their
// broker details — the only thing you cannot fake is the phone.
//
//   1. Start the server with MQTT_URL pointed at any broker you can reach.
//   2. Open the login page → Scan QR. The server logs:
//        QR login attempt: $VASTRA@!QRCODE$xxxxxxxxxxxxxxxSTOREQRCODE
//   3. Copy that topic and run:
//        node devPublishQr.js "$VASTRA@!QRCODE$xxxxxxxxxxxxxxxSTOREQRCODE"
//
// The portal should go "Scan this code" → "Scanned — confirm on your phone" →
// and then fail on the verify call, because Vastra has never heard of a topic
// you invented. That rejection IS the pass condition: it means everything up
// to the Vastra call worked. Only a real scan on a real broker gets further.
//
// Flags:
//   --scan-only     publish just the isVerified message
//   --approve-only  publish just the makeRequest message
//   --mobile=<n>    override the mobile in the approval (default 9876543210)
//   --delay=<ms>    gap between the two messages (default 2500)

import 'dotenv/config';
import mqtt from 'mqtt';

const args = process.argv.slice(2);
const topic = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const scanOnly = args.includes('--scan-only');
const approveOnly = args.includes('--approve-only');
const mobile = flag('mobile', '9876543210');
const delay = Number(flag('delay', '2500'));

if (!topic) {
  console.error('Usage: node devPublishQr.js "<topic>" [--scan-only|--approve-only]');
  console.error('Copy the topic from the server log line "QR login attempt: …".');
  process.exit(1);
}

// The same arithmetic the protocol depends on: 16 + 15 + 11. A topic that is
// not 42 characters means you copied it wrong, and nothing would arrive.
if (topic.length !== 42) {
  console.error(`✗ That topic is ${topic.length} characters, expected 42.`);
  console.error('  Check for a truncated copy — or shell mangling, see the note below.');
  process.exit(1);
}

const url = process.env.MQTT_URL;
if (!url) {
  console.error('✗ MQTT_URL is not set in server/.env — nothing to publish to.');
  process.exit(1);
}

const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  connectTimeout: Number(process.env.MQTT_CONNECT_TIMEOUT) || 10000,
  // One shot — do not sit there retrying if the broker is unreachable.
  reconnectPeriod: 0,
});

const publish = (label, payload) =>
  new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
      if (err) return reject(err);
      console.log(`→ ${label}: ${JSON.stringify(payload)}`);
      resolve();
    });
  });

client.on('error', (err) => {
  console.error(`✗ Broker error: ${err.message}`);
  process.exit(1);
});

client.on('connect', async () => {
  console.log(`Connected to ${url}`);
  console.log(`Topic: ${topic}\n`);
  try {
    if (!approveOnly) {
      // Message 1 — the scan. Progress signal only, carries no credentials.
      await publish('isVerified', { status: true, isVerified: true });
    }
    if (!scanOnly && !approveOnly) {
      console.log(`  (waiting ${delay}ms — watch the portal say "Scanned")`);
      await new Promise((r) => setTimeout(r, delay));
    }
    if (!scanOnly) {
      // Message 2 — the approval. This is what makes the server call
      // admin-user-verifyQRCode.
      await publish('makeRequest', {
        status: true,
        makeRequest: true,
        mobile,
        country_code: '+91',
      });
    }
    console.log('\nDone. Check the server log for the verify call.');
  } catch (err) {
    console.error(`✗ Publish failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.end();
  }
});
