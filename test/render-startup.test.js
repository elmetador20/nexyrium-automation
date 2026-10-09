const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src/app');
const { createDatabaseMonitor } = require('../src/services/database-monitor');
const { parseDatabaseUrl } = require('../src/config/database');
const { requireAdmin } = require('../src/api/admin-auth');
const express = require('express');
const logger = { info() {}, warn() {}, error() {} };

test('HTTP starts before unavailable databases and WhatsApp; SQL recovery starts bot once', async () => {
  const events = [];
  let sqlOnline = false;
  let monitor;
  const deps = {
    prisma: { async $queryRaw() { if (!sqlOnline) throw new Error('offline'); }, async $disconnect() {} },
    conversationProcessor: { processConversation() {} },
    retryWorker: { start() { events.push('worker'); }, stop() {} },
    whatsapp: { async initialize() { events.push('whatsapp'); }, async close() {} },
  };
  const app = createApplication({ deps, config: { PORT: 10000 }, log: logger,
    timers: { setProcessor() {}, clearAll() {} },
    apiFactory: () => ({ async start() { events.push('http'); return { close(fn) { fn(); } }; } }),
    monitorFactory: (options) => (monitor = createDatabaseMonitor(options)),
  });
  await app.bootstrap();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['http']);
  sqlOnline = true;
  await monitor.check();
  await monitor.check();
  assert.deepEqual(events, ['http', 'worker', 'whatsapp']);
  sqlOnline = false;
  await monitor.check();
  sqlOnline = true;
  await monitor.check();
  assert.deepEqual(events, ['http', 'worker', 'whatsapp']);
  await app.shutdown();
});

test('database URL parsing decodes credentials and does not use query text as database name', () => {
  const config = parseDatabaseUrl('mysql://bot:p%40ss%23word@db.example.com:3307/leads?ssl=true');
  assert.equal(config.password, 'p@ss#word');
  assert.equal(config.database, 'leads');
  assert.equal(config.port, 3307);
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(parseDatabaseUrl('mysql://bot:p@@ss@db.example.com/leads').password, 'p@@ss');
});

test('production requires an explicit Google Secret File path and admin token', async (t) => {
  const envPath = require.resolve('../src/config/env');
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_SHEETS_CREDENTIALS_PATH: process.env.GOOGLE_SHEETS_CREDENTIALS_PATH,
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[envPath];
  });
  process.env.NODE_ENV = 'production';
  delete process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
  delete process.env.ADMIN_API_TOKEN;
  delete require.cache[envPath];
  assert.throws(() => require(envPath), /Required environment variables are missing/);
  // The module reports both names in its startup diagnostic; avoid exposing
  // the entire process environment in the test output.
});

test('QR/admin routes reject anonymous requests and accept bearer authorization', async (t) => {
  const previous = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = 'a'.repeat(40);
  t.after(() => { if (previous === undefined) delete process.env.ADMIN_API_TOKEN; else process.env.ADMIN_API_TOKEN = previous; });
  const app = express();
  app.get('/qr', requireAdmin, (_req, res) => res.json({ available: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/qr`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } })).status, 200);
});
