import 'dotenv/config';
import { createApp } from './app.js';
import { pingDb, dbTarget, applyAuthSchema } from './db.js';

const port = Number(process.env.PORT) || 4000;

// Probe the database at boot. We still start listening on failure — the app
// should stay up to serve /api/health and the client shell — but the log says
// exactly what is wrong instead of leaving it to per-request 503s.
const err = await pingDb();
if (err) {
  console.error(`\n  ✗ Cannot reach the database at ${dbTarget()}`);
  console.error(`    ${err.code || 'ERROR'}: ${err.message}`);
  if (err.code === 'ENOTFOUND') {
    console.error('    That hostname does not resolve — the database server no longer');
    console.error('    exists, or DB_HOST is wrong. Managed free tiers (Aiven, Railway,');
    console.error('    PlanetScale) delete expired instances and remove their DNS record.');
  } else if (err.code === 'ECONNREFUSED') {
    console.error('    Host resolves but nothing is listening — is MySQL running?');
  } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('    Wrong DB_USER / DB_PASSWORD.');
  } else if (err.code === 'ER_BAD_DB_ERROR') {
    console.error(`    Database "${process.env.DB_NAME || 'rms'}" missing — run: npm run seed`);
  }
  console.error('    The API will start, but every data route returns 503 until fixed.\n');
} else {
  console.log(`DB connected: ${dbTarget()}`);
  // Auth tables are not in schema.sql (seed drops that), so create them here.
  // Idempotent — every restart re-runs it harmlessly.
  try {
    await applyAuthSchema();
  } catch (e) {
    console.error(`  ✗ Could not apply auth schema (${e.code || 'ERROR'}): ${e.message}`);
    console.error('    Login will fail until this is fixed.\n');
  }
}

createApp().listen(port, () => console.log(`RMS API on http://localhost:${port}`));
