const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PersistentRemoteAuth } = require('../src/integrations/whatsapp/remote-auth');
const { createRemoteStore } = require('../src/integrations/whatsapp/remote-store');
const logger = { info() {}, warn() {} };

test('actual installed RemoteAuth ZIP restores after every local profile file is deleted', async (t) => {
  const base = process.platform === 'linux' && existsSync('/tmp/omnirush') ? '/tmp/omnirush' : os.tmpdir();
  const root = await fs.mkdtemp(path.join(base, 'wa-archive-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let archive = null;
  const store = {
    async sessionExists() { return archive !== null; },
    async save({ session }) { archive = await fs.readFile(path.join(root, `${session}.zip`)); },
    async extract({ path: destination }) { await fs.writeFile(destination, archive); },
  };
  const create = () => {
    const auth = new PersistentRemoteAuth({ store, clientId: 'archive-test', dataPath: root, backupSyncIntervalMs: 60_000 }, logger);
    auth.setup(Object.assign(new EventEmitter(), { options: { puppeteer: {} } }));
    return auth;
  };
  const first = create();
  await first.beforeBrowserInitialized();
  const indexed = path.join(first.userDataDir, 'Default', 'IndexedDB');
  const local = path.join(first.userDataDir, 'Default', 'Local Storage');
  await fs.mkdir(indexed, { recursive: true });
  await fs.mkdir(local, { recursive: true });
  await fs.writeFile(path.join(indexed, 'fixture'), 'non-secret simulated login database');
  await fs.writeFile(path.join(local, 'fixture'), 'non-secret simulated browser storage');
  await first.storeRemoteSession({ emit: true });
  assert.ok(archive.length > 0);
  await first.destroy();
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root);
  const restarted = create();
  await restarted.beforeBrowserInitialized();
  assert.equal(await fs.readFile(path.join(restarted.userDataDir, 'Default', 'IndexedDB', 'fixture'), 'utf8'), 'non-secret simulated login database');
  assert.equal(await fs.readFile(path.join(restarted.userDataDir, 'Default', 'Local Storage', 'fixture'), 'utf8'), 'non-secret simulated browser storage');
  await restarted.destroy();
});

test('Mongo lease prevents another process from owning the same session and releases on stop', async () => {
  let lease = null;
  const database = {
    collection() {
      return {
        async updateOne(filter, update) {
          if (lease && lease.owner !== filter.$or?.[0]?.owner && lease.owner !== filter.owner) throw new Error('duplicate key');
          const existed = !!lease;
          lease = { _id: filter._id, ...update.$set };
          return { matchedCount: existed ? 1 : 0, upsertedCount: existed ? 0 : 1 };
        },
        async findOne(filter) { return lease?.owner === filter.owner ? lease : null; },
        async deleteOne(filter) { if (lease?.owner === filter.owner) lease = null; },
      };
    },
  };
  const mongoose = () => ({
    connection: Object.assign(new EventEmitter(), { readyState: 0, db: database }),
    async connect() { this.connection.readyState = 1; }, async disconnect() { this.connection.readyState = 0; },
  });
  const create = () => createRemoteStore({ config: { clientId: 'lease-test', mongoUri: 'not-a-real-connection' }, logger,
    mongoose: mongoose(), Store: class {} });
  const a = create();
  const b = create();
  await a.acquire(() => {});
  await assert.rejects(b.acquire(() => {}), /lease unavailable/);
  await a.release();
  await b.acquire(() => {});
  await a.close();
  await b.close();
});

test('MongoStore ZIP path bridge uploads from configured dataPath and removes its temporary file', async (t) => {
  const base = process.platform === 'linux' && existsSync('/tmp/omnirush') ? '/tmp/omnirush' : os.tmpdir();
  const root = await fs.mkdtemp(path.join(base, 'wa-bridge-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const clientId = `bridge-${Date.now()}`;
  const session = `RemoteAuth-${clientId}`;
  const target = path.resolve(`${session}.zip`);
  t.after(() => fs.rm(target, { force: true }));
  await fs.writeFile(path.join(root, `${session}.zip`), 'fixture-archive');
  const lease = {};
  const db = { collection: () => ({
    async updateOne(_filter, update) { Object.assign(lease, update.$set); return { upsertedCount: 1 }; },
    async findOne(filter) { return lease.owner === filter.owner ? lease : null; }, async deleteOne() {},
  }) };
  const mongoose = {
    connection: Object.assign(new EventEmitter(), { readyState: 0, db }),
    async connect() { this.connection.readyState = 1; }, async disconnect() {},
  };
  let uploaded;
  class Store { async save({ session: name }) { uploaded = await fs.readFile(`${name}.zip`, 'utf8'); } }
  const remote = createRemoteStore({ config: { clientId, dataPath: root }, logger, mongoose, Store });
  await remote.acquire(() => {});
  await remote.adapter.save({ session });
  assert.equal(uploaded, 'fixture-archive');
  assert.ok(remote.getLastSavedAt());
  await assert.rejects(fs.access(target));
  await remote.close();
});

test('a late failed heartbeat from a released lease cannot stop the new lease', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let failOldRenewal;
  let renewals = 0;
  let lost = 0;
  const db = { collection: () => ({
    async updateOne(filter) {
      if (filter.$or) return { upsertedCount: 1 };
      renewals++;
      if (renewals === 1) return new Promise((_resolve, reject) => { failOldRenewal = reject; });
      return { matchedCount: 1 };
    },
    async deleteOne() {},
  }) };
  const mongoose = {
    connection: Object.assign(new EventEmitter(), { readyState: 0, db }),
    async connect() { this.connection.readyState = 1; }, async disconnect() {},
  };
  const remote = createRemoteStore({ config: { clientId: 'generation-test' }, logger, mongoose, Store: class {} });
  await remote.acquire(() => { lost++; });
  t.mock.timers.tick(20_000);
  await new Promise((resolve) => setImmediate(resolve));
  await remote.release();
  await remote.acquire(() => { lost++; });
  failOldRenewal(new Error('old network failure'));
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(20_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lost, 0);
  assert.equal(renewals, 2);
  await remote.close();
});

test('a delayed heartbeat stops the client instead of reviving an expired lease', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  let lease;
  let lost = 0;
  const db = { collection: () => ({
    async updateOne(filter, update) {
      if (filter.$or) { lease = update.$set; return { upsertedCount: 1 }; }
      if (lease.owner !== filter.owner || (filter.expiresAt && lease.expiresAt <= filter.expiresAt.$gt)) {
        return { matchedCount: 0 };
      }
      lease = update.$set;
      return { matchedCount: 1 };
    },
    async deleteOne() {},
  }) };
  const mongoose = {
    connection: Object.assign(new EventEmitter(), { readyState: 0, db }),
    async connect() { this.connection.readyState = 1; }, async disconnect() {},
  };
  const remote = createRemoteStore({ config: { clientId: 'expiry-test' }, logger, mongoose, Store: class {} });
  await remote.acquire(() => { lost++; });
  // Simulate a stalled event loop: callbacks run after the 90-second lease ends.
  t.mock.timers.tick(90_001);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lost, 1);
  assert.equal(lease.expiresAt.getTime(), 90_000);
  t.mock.timers.tick(20_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lost, 1);
  await remote.close();
});
