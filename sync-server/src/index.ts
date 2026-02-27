import 'dotenv/config';

import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSyncRoutes } from './routes/sync.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = await createPool(config);

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get('/v1/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok', now: new Date().toISOString() });
    } catch {
      res.status(500).json({ status: 'error' });
    }
  });

  app.use('/v1/auth', registerAuthRoutes({ pool, config }));
  app.use('/v1/sync', registerSyncRoutes({ pool, config }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`[sync-server] listening on http://${config.HOST}:${config.PORT}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[sync-server] ${signal} received, shutting down...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[sync-server] fatal startup error', error);
  process.exit(1);
});
