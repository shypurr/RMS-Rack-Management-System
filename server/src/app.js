import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import racks from './routes/racks.js';
import itemLocations from './routes/itemLocations.js';
import moves from './routes/moves.js';
import sourceTransactions from './routes/sourceTransactions.js';
import auditLog from './routes/audit.js';
import dashboard from './routes/dashboard.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/dashboard', dashboard);
  app.use('/api/racks', racks);
  app.use('/api/item-locations', itemLocations);
  app.use('/api/moves', moves);
  app.use('/api/source-transactions', sourceTransactions);
  app.use('/api/audit-log', auditLog);

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
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}
