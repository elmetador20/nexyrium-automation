const test = require('node:test');
const assert = require('node:assert/strict');

test('logger redacts auth fields, private keys, connection strings, and configured secrets', () => {
  const logger = require('../src/lib/logger');
  const outputs = [];
  const original = console.error;
  console.error = (line) => outputs.push(line);
  try {
    logger.error('Connection mongodb+srv://example-user:example-password@cluster.example/db failed', {
      qr: 'EXAMPLE_QR_VALUE', cookies: 'EXAMPLE_COOKIE_VALUE', privateKey: 'EXAMPLE_KEY_VALUE',
      token: 'EXAMPLE_TOKEN_VALUE', nested: { password: 'EXAMPLE_PASSWORD_VALUE' },
    });
  } finally { console.error = original; }
  const text = outputs.join('\n');
  for (const value of ['EXAMPLE_QR_VALUE', 'EXAMPLE_COOKIE_VALUE', 'EXAMPLE_KEY_VALUE', 'EXAMPLE_TOKEN_VALUE', 'EXAMPLE_PASSWORD_VALUE', 'example-password']) {
    assert.equal(text.includes(value), false);
  }
  assert.ok(text.includes('REDACTED'));
});

test('logger keeps complete nested startup error details while redacting secrets', () => {
  const logger = require('../src/lib/logger');
  const outputs = [];
  const original = console.error;
  console.error = (line) => outputs.push(line);
  try {
    const cause = new Error('Mongo failed for mongodb+srv://user:password@cluster.example/db');
    const error = new Error('Startup failed for mysql://user:password@db.example/leads', { cause });
    error.code = 'ENOENT';
    logger.error('Application startup failed', { error: logger.describeError(error) });
  } finally { console.error = original; }
  const text = outputs.join('\n');
  assert.ok(text.includes('"name":"Error"'));
  assert.ok(text.includes('"code":"ENOENT"'));
  assert.ok(text.includes('"cause"'));
  assert.ok(text.includes('"stack"'));
  assert.equal(text.includes('password@'), false);
  assert.equal(text.includes('mongodb+srv://user:password'), false);
  assert.equal(text.includes('mysql://user:password'), false);
});
