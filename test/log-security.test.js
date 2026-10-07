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
