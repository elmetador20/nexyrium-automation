/** Exercise the real TypeScript API helper with a simulated browser and server. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('../dashboard/node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../dashboard/src/lib/api.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function browser(answers) {
  const storage = new Map();
  let prompts = 0;
  const exports = {};
  const context = vm.createContext({
    exports, process: { env: { NEXT_PUBLIC_API_URL: 'https://fixture.onrender.com' } },
    window: {
      prompt: () => { prompts++; return answers.shift() ?? null; },
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
    },
    fetch: async (url, options) => {
      assert.ok(url.startsWith('https://fixture.onrender.com/api/'));
      const ok = options.headers.Authorization === 'Bearer valid-fixture-token';
      return { ok, status: ok ? 200 : 401, json: async () => ok ? { success: true } : { error: 'Unauthorized' } };
    },
  });
  vm.runInContext(compiled, context);
  return { api: exports.api, storage, prompts: () => prompts };
}

(async () => {
  const concurrent = browser(['valid-fixture-token']);
  await Promise.all([concurrent.api.dashboard.stats(), concurrent.api.dashboard.status(), concurrent.api.whatsapp.status()]);
  assert.equal(concurrent.prompts(), 1, 'concurrent requests must share one token prompt');
  assert.equal(concurrent.storage.get('nexyrium-admin-token'), 'valid-fixture-token');
  await concurrent.api.settings.get();
  assert.equal(concurrent.prompts(), 1, 'a stored valid token must not prompt again');

  const invalid = browser(['wrong-fixture-token', 'valid-fixture-token']);
  await assert.rejects(invalid.api.whatsapp.status(), /Unauthorized/);
  assert.equal(invalid.storage.size, 0, 'an invalid token must not remain stored');
  await invalid.api.whatsapp.status();
  assert.equal(invalid.prompts(), 2, 'a later request must allow correction of an invalid token');

  const cancelled = browser([null]);
  const results = await Promise.allSettled([cancelled.api.dashboard.stats(), cancelled.api.whatsapp.status()]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(cancelled.prompts(), 1, 'cancellation must not cause a prompt storm');
  assert.equal(cancelled.storage.size, 0);
  console.log('Dashboard authorization checks passed: concurrent requests, invalid-token retry, and cancellation.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
