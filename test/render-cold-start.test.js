const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

test('real production entry point serves public health while both databases are unreachable', { timeout: 120_000 }, async (t) => {
  const base = process.platform === 'linux' && existsSync('/tmp/omnirush') ? '/tmp/omnirush' : os.tmpdir();
  const root = await fs.mkdtemp(path.join(base, 'render-cold-start-'));
  const credentials = path.join(root, 'credentials.json');
  await fs.writeFile(credentials, '{}', { mode: 0o600 });
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const token = 'non-secret-production-fixture-token';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../index.js')], {
    // dotenv reads this empty fixture directory, never the project's real .env.
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port),
      DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:9/leads',
      WHATSAPP_MONGODB_URI: 'mongodb://127.0.0.1:9/whatsapp_auth',
      WHATSAPP_SESSION_DATA_PATH: path.join(root, '.wwebjs_auth'),
      ADMIN_API_TOKEN: token, OPENROUTER_API_KEY: 'non-secret-fixture',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'non-secret-fixture', GOOGLE_SHEETS_CREDENTIALS_PATH: credentials,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output = (output + data).slice(-8192); });
  child.stderr.on('data', (data) => { output = (output + data).slice(-8192); });
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      const kill = setTimeout(() => child.kill('SIGKILL'), 25_000);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(kill);
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  // Slow Windows-mounted module reads can take >30s before HTTP even starts.
  // Once loaded, liveness must still succeed without connecting either database.
  const deadline = Date.now() + 90_000;
  let health;
  while (Date.now() < deadline && child.exitCode === null && !spawnError) {
    try {
      health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(health?.status, 200, `HTTP startup failed: ${spawnError?.message || output}`);
  assert.equal((await health.json()).status, 'ok');
  assert.equal((await fetch(`${url}/api/health`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${url}/api/whatsapp/status`)).status, 401);
  const status = await fetch(`${url}/api/whatsapp/status`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(body.connected, false);
  assert.equal(body.qrRequired, false);
  assert.equal(body.authStrategy, 'RemoteAuth');
});
