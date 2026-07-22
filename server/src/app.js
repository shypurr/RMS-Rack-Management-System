import express from 'express';
import cors from 'cors';
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

  // Central error handler → maps HttpError.status, defaults to 500.
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}
