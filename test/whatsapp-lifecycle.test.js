const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWhatsAppClient } = require('../src/integrations/whatsapp/client');
const { PersistentRemoteAuth } = require('../src/integrations/whatsapp/remote-auth');

const logger = { info() {}, warn() {}, debug() {}, error() {} };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const config = { clientId: 'test', dataPath: '/tmp/omnirush/unused-profile', backupIntervalMs: 60_000 };

function fixture({ ClientClass = null, log = logger, getChromeInfo = () => ({
  puppeteerVersion: '24.38.0', expectedChromeRevision: '146.0.7680.31',
  executablePath: '/project/.puppeteer-cache/chrome-linux64/chrome', exists: true,
}), verifyChrome = () => {} } = {}) {
  const clients = [];
  const calls = { leases: 0, released: 0, handlers: 0, remoteDeleted: 0 };
  let lost;
  class Auth {
    constructor(options) { this.options = options; }
    async destroy() {}
    async logout() { calls.remoteDeleted++; }
  }
  class FakeClient extends EventEmitter {
    constructor(options) { super(); this.options = options; this.authStrategy = options.authStrategy; clients.push(this); }
    async initialize() { this.initialized = true; }
    async destroy() { this.destroyed = true; }
  }
  const store = {
    async acquire(handler) { calls.leases++; lost = handler; },
    async release() { calls.released++; },
    async close() {},
    async reset() { calls.remoteDeleted++; },
    adapter: {}, getLastSavedAt: () => '2026-10-07T10:00:00.000Z',
  };
  const service = createWhatsAppClient({ config, logger: log, ClientClass: ClientClass || FakeClient, AuthClass: Auth,
    remoteStore: store, getChromeInfo, verifyChrome,
    createEventHandler: () => ({ register() { calls.handlers++; } }) });
  return { service, clients, calls, store, loseLease: () => lost() };
}

test('WhatsApp client passes the verified project-local Chrome executable to Puppeteer', async () => {
  const f = fixture();
  await f.service.initialize();
  assert.equal(f.clients[0].options.puppeteer.executablePath, '/project/.puppeteer-cache/chrome-linux64/chrome');
  assert.deepEqual(f.clients[0].options.puppeteer.args, [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  ]);
  await f.service.close();
});

test('failed browser initialization logs only safe error details before retrying', async () => {
  const warnings = [];
  const log = { info() {}, debug() {}, error() {}, warn(...args) { warnings.push(args); } };
  class FailingClient extends EventEmitter {
    constructor(options) { super(); this.authStrategy = options.authStrategy; }
    async initialize() { throw new Error('browser launch failed'); }
    async destroy() {}
  }
  const f = fixture({ ClientClass: FailingClient, log });
  await f.service.initialize();
  await flush();
  assert.equal(f.calls.released, 2);
  const failure = warnings.find(([message]) => message === 'WhatsApp initialization failed');
  assert.ok(failure);
  assert.equal(failure[1].name, 'Error');
  assert.equal(failure[1].message, 'browser launch failed');
  assert.match(failure[1].stack, /Error: browser launch failed/);
  assert.deepEqual(Object.keys(failure[1]).sort(), ['message', 'name', 'stack']);
  await f.service.destroy();
});

test('concurrent initialize and reconnect requests do not create duplicate clients', async () => {
  const f = fixture();
  const first = f.service.initialize();
  assert.equal(first, f.service.initialize());
  await Promise.all([first, f.service.initialize(), f.service.initialize()]);
  assert.equal(f.clients.length, 1);
  await Promise.all([f.service.reconnect(), f.service.reconnect(), f.service.reconnect()]);
  assert.equal(f.clients.length, 2);
  assert.equal(f.clients[0].destroyed, true);
  assert.equal(f.calls.handlers, 2);
  await f.service.close();
});

test('QR data stays in memory and authentication/ready status clear it', async () => {
  const f = fixture();
  await f.service.initialize();
  f.clients[0].emit('qr', 'PRIVATE_QR_TEST_VALUE');
  assert.equal(f.service.getQr(), 'PRIVATE_QR_TEST_VALUE');
  assert.equal(f.service.getStatus().qrRequired, true);
  f.clients[0].emit('authenticated');
  f.clients[0].emit('ready');
  assert.equal(f.service.getQr(), null);
  assert.equal(f.service.getStatus().connected, true);
  await f.service.close();
});

test('temporary disconnect reconnects without deleting remote authentication', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  await f.service.initialize();
  f.clients[0].emit('ready');
  f.clients[0].emit('disconnected', 'CONFLICT');
  await flush();
  assert.equal(f.clients[0].destroyed, true);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(f.clients.length, 2);
  assert.equal(f.calls.remoteDeleted, 0);
  f.clients[1].emit('ready');
  assert.equal(f.service.getStatus().connected, true);
  await f.service.close();
});

test('duplicate recovery events queue only one cleanup and retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  await f.service.initialize();
  const initialReleases = f.calls.released;
  f.clients[0].emit('disconnected', 'NETWORK');
  f.clients[0].emit('disconnected', 'CONFLICT');
  await flush();
  assert.equal(f.calls.released, initialReleases + 1);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(f.clients.length, 2);
  await f.service.close();
});

test('network timeout, storage/lease interruption, and browser crashes trigger recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  await f.service.initialize();
  f.clients[0].emit('change_state', 'TIMEOUT');
  t.mock.timers.tick(120_000);
  await flush();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(f.clients.length, 2);
  f.loseLease();
  await flush();
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(f.clients.length, 3);
  f.clients[2].pupBrowser = new EventEmitter();
  f.clients[2].emit('ready');
  f.clients[2].pupBrowser.emit('disconnected');
  await flush();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(f.clients.length, 4);
  assert.equal(f.calls.remoteDeleted, 0);
  await f.service.close();
});

test('a manual stop cancels pending automatic reconnection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  await f.service.initialize();
  f.clients[0].emit('disconnected', 'NETWORK');
  await flush();
  await f.service.destroy();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(f.clients.length, 1);
  assert.equal(f.service.getStatus().state, 'stopped');
});

test('terminal close stops retries and does not allow a second initialization', async () => {
  const f = fixture();
  await f.service.initialize();
  await f.service.close();
  assert.equal(f.service.getStatus().state, 'stopped');
  assert.equal(await f.service.initialize(), null);
  assert.equal(f.clients.length, 1);
});

test('RemoteAuth preserves archives on temporary disconnect and deletes only on logout', async () => {
  let deleted = 0;
  const auth = new PersistentRemoteAuth({ ...config, store: {
    async sessionExists() { return true; }, async delete() { deleted++; },
  }, backupSyncIntervalMs: 60_000 }, logger);
  auth.userDataDir = '/tmp/omnirush/nonexistent-session';
  auth.sessionName = 'RemoteAuth-test';
  await auth.disconnect();
  assert.equal(deleted, 0);
  await Promise.all([auth.logout(), auth.logout()]);
  assert.equal(deleted, 1);
});

test('first QR login waits for stabilization and retries a failed first remote backup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const auth = new PersistentRemoteAuth({ ...config, store: { async sessionExists() { return false; } }, backupSyncIntervalMs: 60_000 }, logger);
  let saved = 0;
  auth.storeRemoteSession = async () => { if (++saved === 1) throw new Error('Network unavailable'); auth.saved = true; };
  const ready = auth.afterAuthReady();
  await flush();
  t.mock.timers.tick(59_999);
  assert.equal(saved, 0);
  t.mock.timers.tick(1);
  await ready;
  assert.equal(saved, 1);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(saved, 2);
  assert.equal(auth.saved, true);
  await auth.destroy();
});

test('a restored session skips first-login delay; a new authentication replaces a stale archive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const make = () => new PersistentRemoteAuth({ ...config, store: { async sessionExists() { return true; } }, backupSyncIntervalMs: 60_000 }, logger);
  const restored = make();
  await restored.afterAuthReady();
  assert.equal(restored.saved, true);
  await restored.destroy();
  const stale = make();
  await stale.onAuthenticationNeeded();
  let saved = false;
  stale.storeRemoteSession = async () => { saved = true; };
  const ready = stale.afterAuthReady();
  await flush();
  t.mock.timers.tick(60_000);
  await ready;
  assert.equal(saved, true);
  await stale.destroy();
});

test('concurrent remote backups share one compression/upload and cleanup task', async () => {
  let resolveCompression;
  let uploads = 0;
  let compressions = 0;
  const auth = new PersistentRemoteAuth({ ...config, store: { async save() { uploads++; } }, backupSyncIntervalMs: 60_000 }, logger);
  auth.userDataDir = '/tmp/omnirush/unused-profile';
  auth.isValidPath = async () => true;
  auth.compressSession = async () => {
    compressions++;
    await new Promise((resolve) => { resolveCompression = resolve; });
  };
  const first = auth.storeRemoteSession();
  assert.equal(first, auth.storeRemoteSession());
  await flush();
  resolveCompression();
  await first;
  assert.equal(compressions, 1);
  assert.equal(uploads, 1);
  await auth.destroy();
});

test('shutdown cancels the first-save delay and never schedules a later backup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const auth = new PersistentRemoteAuth({ ...config, store: { async sessionExists() { return false; } }, backupSyncIntervalMs: 60_000 }, logger);
  let saves = 0;
  auth.storeRemoteSession = async () => { saves++; };
  const ready = auth.afterAuthReady();
  await flush();
  await auth.destroy();
  await ready;
  t.mock.timers.tick(300_000);
  await flush();
  assert.equal(saves, 0);
});
