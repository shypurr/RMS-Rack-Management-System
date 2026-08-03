import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isConnectionError, dbTarget, pingDb } from './db.js';
import { requireAuth } from './middleware/requireAuth.js';
import auth from './routes/auth.js';
import racks from './routes/racks.js';
import itemLocations from './routes/itemLocations.js';
import moves from './routes/moves.js';
import sourceTransactions from './routes/sourceTransactions.js';
import picklist from './routes/picklist.js';
import auditLog from './routes/audit.js';
import dashboard from './routes/dashboard.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health includes DB reachability so a broken deployment is one curl away.
  // `host` is the configured hostname only — no user, port or credentials.
  app.get('/api/health', async (req, res) => {
    const err = await pingDb();
    if (!err) return res.json({ ok: true, db: 'up' });
    res.status(503).json({
      ok: false,
      db: 'down',
      code: err.code || 'UNKNOWN',
      host: process.env.DB_HOST || '127.0.0.1',
    });
  });

  // Vastra mobile+OTP login. Unauthenticated by definition — it is how you get
  // a session. /api/health above stays public too (the troubleshooting section
  // in the README depends on being able to curl it).
  app.use('/api/auth', auth);

  // Everything else needs a session.
  app.use('/api/dashboard', requireAuth, dashboard);
  app.use('/api/racks', requireAuth, racks);
  app.use('/api/item-locations', requireAuth, itemLocations);
  app.use('/api/moves', requireAuth, moves);
  app.use('/api/source-transactions', requireAuth, sourceTransactions);
  app.use('/api/picklist', requireAuth, picklist);
  app.use('/api/audit-log', requireAuth, auditLog);

  // In production serve the built React client from the same origin (so the
  // client's relative /api calls just work — no CORS, no second service).
  // Skipped in local dev where dist doesn't exist and Vite serves the client.
  const clientDist = path.resolve(fileURLToPath(import.meta.url), '../../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next(); // let unknown API routes 404 as JSON
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Central error handler → maps HttpError.status, defaults to 500.
  app.use((err, req, res, _next) => {
    // A dead/unreachable database is an infrastructure fault, not a bad request.
    // Report it as 503 with a generic message — the driver's own message embeds
    // the DB host, port and user, which must not reach the browser.
    if (isConnectionError(err)) {
      console.error(`DB unreachable (${err.code}) at ${dbTarget()}:`, err.message);
      return res.status(503).json({
        error: 'Database unavailable — the API cannot reach its database. Check the server logs.',
      });
    }
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}
