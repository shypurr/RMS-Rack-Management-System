// Dev tool: a local MQTT broker, so QR login can be tested without Vastra's.
//
//   node devBroker.js          → mqtt://127.0.0.1:1883
//   node devBroker.js 18831    → a different port
//
// then in server/.env:
//   MQTT_URL=mqtt://127.0.0.1:1883
//
// A public broker (broker.hivemq.com) does work for this, but it is shared and
// unmetered — connections are accepted and then publishes can sit there for
// tens of seconds. Running your own removes that variable entirely, and keeps
// test payloads (which carry a mobile number) off a public host.
//
// aedes is a devDependency — this file is never imported by the app.

import { Aedes } from 'aedes';
import { createServer } from 'node:net';

const port = Number(process.argv[2]) || 1883;
const broker = await Aedes.createBroker({});

broker.on('client', (c) => console.log(`+ client ${c.id}`));
broker.on('clientDisconnect', (c) => console.log(`- client ${c.id}`));
broker.on('subscribe', (subs, c) => {
  for (const s of subs) console.log(`  ${c.id} subscribed: ${s.topic}`);
});
// Echoing publishes is the fastest way to tell "Vastra never published" apart
// from "we subscribed to the wrong topic" — the two failures look identical
// from the portal, which just sits on the QR either way.
broker.on('publish', (packet, c) => {
  if (!c) return; // broker-internal ($SYS) traffic
  console.log(`  ${c.id} published to ${packet.topic}: ${packet.payload}`);
});

createServer(broker.handle).listen(port, () => {
  console.log(`Dev MQTT broker on mqtt://127.0.0.1:${port}`);
  console.log(`  MQTT_URL=mqtt://127.0.0.1:${port}\n`);
});
