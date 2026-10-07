const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('actual API keeps health public and protects status, dashboard, and admin actions', async (t) => {
  const containerPath = require.resolve('../src/container');
  const previousContainer = require.cache[containerPath];
  const oldToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = 'test-admin-token-'.repeat(3);
  t.after(() => {
    if (previousContainer) require.cache[containerPath] = previousContainer;
    else delete require.cache[containerPath];
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  });
  const client = new EventEmitter();
  const fake = {
    whatsapp: {
      getClient: () => client,
      getStatus: () => ({ connected: false, qrRequired: false, authStrategy: 'RemoteAuth' }),
      getQr: () => 'fixture-only',
      async reconnect() {}, async destroy() {},
    },
    retryWorker: { stop() {}, start() {} },
    extractor: { async extractLeadData() { throw new Error('provider error containing private fixture data'); } },
    prisma: { lead: { async findMany() { return []; } } },
  };
  require.cache[containerPath] = { id: containerPath, filename: containerPath, loaded: true, exports: fake };
  const { createApiServer } = require('../src/api/server');
  const server = await createApiServer(0).start();
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  for (const [method, route] of [
    ['GET', '/api/whatsapp/status'], ['GET', '/api/whatsapp/qr'], ['GET', '/api/whatsapp/qr-image'],
    ['GET', '/api/settings'], ['GET', '/api/dashboard/stats'], ['GET', '/api/leads'],
    ['GET', '/api/logs'], ['GET', '/api/conversations'], ['POST', '/api/settings/restart-worker'],
    ['POST', '/api/settings/test-ai'], ['POST', '/api/settings/sync-sheets'],
    ['POST', '/api/settings/reconnect-whatsapp'], ['POST', '/api/whatsapp/reconnect'],
    ['POST', '/api/whatsapp/disconnect'], ['POST', '/api/whatsapp/reset-session'],
    ['PATCH', '/api/leads/example/assignment'],
  ]) {
    assert.equal((await fetch(`${base}${route}`, { method })).status, 401, route);
  }
  const headers = { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` };
  const status = await fetch(`${base}/api/whatsapp/status`, { headers });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    connected: false, qrRequired: false, authStrategy: 'RemoteAuth',
    phoneNumber: null, name: null, platform: null,
  });
  assert.equal((await fetch(`${base}/api/settings/restart-worker`, { method: 'POST', headers })).status, 200);
  const ai = await fetch(`${base}/api/settings/test-ai`, { method: 'POST', headers });
  assert.deepEqual(await ai.json(), {
    success: false, error: 'AI connection test failed; check the configured service',
  });
  // Liveness stays available while WhatsApp is disconnected.
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
