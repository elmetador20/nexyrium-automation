/**
 * Express REST API server.
 *
 * Thin HTTP layer that exposes existing container services.
 * Starts on process.env.PORT (default 10000) alongside the worker.
 *
 * @module api/server
 */

const express = require('express');
const cors = require('cors');
const logger = require('../lib/logger');

const dashboardRoutes = require('./routes/dashboard');
const whatsappRoutes = require('./routes/whatsapp');
const leadsRoutes = require('./routes/leads');
const settingsRoutes = require('./routes/settings');
const logsRoutes = require('./routes/logs');
const { createHealthRouter } = require('./routes/health');
const { requireAdmin } = require('./admin-auth');

function createApiServer(port = Number(process.env.PORT) || 10000) {
  const app = express();

  const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || 'https://nexyrium-automation.vercel.app')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      // Do not reflect arbitrary origins. Let the request complete without
      // CORS headers so browsers enforce the policy without turning it into
      // an internal server error for health monitors and server-side callers.
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  }));

  app.use(express.json());

  // Keep health checks independent from the database, WhatsApp, and Sheets.
  // External monitors can use either URL depending on their deployment setup.
  const healthRoutes = createHealthRouter();
  app.use('/health', healthRoutes);
  app.use('/api/health', healthRoutes);

  // Dashboard, lead data, session/status, and control routes are administrative.
  // Only liveness endpoints are anonymous; external monitors need no token.
  app.use('/api', requireAdmin);

  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  app.use('/api/leads', leadsRoutes);
  app.use('/api/conversations', leadsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/logs', logsRoutes);

  app.use((err, _req, res, _next) => {
    logger.error('API request failed', { code: err.code || 'INTERNAL_ERROR' });
    const status = err.status === 429 || err.status === 503 ? err.status : 500;
    if (status === 429 && err.retryAfterMs) {
      res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
    }
    res.status(status).json({ error: status === 503 ? 'Service unavailable' : 'Internal server error' });
  });

  function start() {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, '0.0.0.0', () => {
        logger.info(`API server listening on 0.0.0.0:${port}`);
        resolve(server);
      });
      server.once('error', reject);
    });
  }

  return { app, start };
}

module.exports = { createApiServer };
