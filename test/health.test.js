const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createHealthRouter } = require('../src/api/routes/health');

function createTestApp() {
  const app = express();
  app.use(createHealthRouter());
  return app;
}

test('health endpoint responds without application dependencies', async (t) => {
  const server = http.createServer(createTestApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'whatsapp-lead-automation');
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.ok(body.timestamp);
});

test('health endpoint supports HEAD checks', async (t) => {
  const server = http.createServer(createTestApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});
