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

function duplicateKeyError() {
  const error = new Error('duplicate key');
  error.code = 11000;
  return error;
}

function createLeaseDatabase() {
  const state = { lease: null };
  const collection = {
    async findOne(filter) {
      const lease = state.lease;
      if (!lease || lease._id !== filter._id) return null;
      if (filter.owner && lease.owner !== filter.owner) return null;
      if (filter.expiresAt?.$gt && !(lease.expiresAt > filter.expiresAt.$gt)) return null;
      return { ...lease };
    },
    async insertOne(document) {
      if (state.lease) throw duplicateKeyError();
      state.lease = { ...document };
      return { acknowledged: true, insertedId: document._id };
    },
    async updateOne(filter, update) {
      const lease = state.lease;
      if (!lease || lease._id !== filter._id) return { matchedCount: 0 };
      if (filter.owner && lease.owner !== filter.owner) return { matchedCount: 0 };
      if (filter.expiresAt?.$gt && !(lease.expiresAt > filter.expiresAt.$gt)) return { matchedCount: 0 };
      if (filter.$or && !filter.$or.some((condition) => (
        (condition.owner && lease.owner === condition.owner)
        || (condition.expiresAt?.$lte && lease.expiresAt <= condition.expiresAt.$lte)
      ))) return { matchedCount: 0 };
      state.lease = { ...lease, ...update.$set };
      return { matchedCount: 1 };
    },
    async deleteOne(filter) {
      if (state.lease?._id === filter._id && state.lease.owner === filter.owner) state.lease = null;
    },
  };
  return { state, collection: () => collection };
}

function createLeaseMongoose(database) {
  return {
    connection: Object.assign(new EventEmitter(), { readyState: 0, db: database }),
    async connect() { this.connection.readyState = 1; },
    async disconnect() { this.connection.readyState = 0; },
  };
}

function createLeaseRemote(database, clientId) {
  return createRemoteStore({
    config: { clientId, mongoUri: 'not-a-real-connection' },
    logger, mongoose: createLeaseMongoose(database), Store: class {},
  });
}

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
  const database = createLeaseDatabase();
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

test('Mongo lease acquisition creates a missing lease and repeated acquisition keeps ownership', async () => {
  const database = createLeaseDatabase();
  const remote = createLeaseRemote(database, 'missing-and-repeat');
  await remote.acquire(() => {});
  const firstOwner = database.state.lease.owner;
  await remote.acquire(() => {});
  assert.equal(database.state.lease.owner, firstOwner);
  await remote.close();
});

test('Mongo lease acquisition replaces an expired lease but not a valid lease', async () => {
  const database = createLeaseDatabase();
  database.state.lease = {
    _id: 'RemoteAuth-expired', owner: 'old-owner', expiresAt: new Date(Date.now() - 1_000),
  };
  const remote = createLeaseRemote(database, 'expired');
  await remote.acquire(() => {});
  assert.notEqual(database.state.lease.owner, 'old-owner');
  await remote.close();

  const validDatabase = createLeaseDatabase();
  validDatabase.state.lease = {
    _id: 'RemoteAuth-valid', owner: 'live-owner', expiresAt: new Date(Date.now() + 90_000),
  };
  const blocked = createLeaseRemote(validDatabase, 'valid');
  await assert.rejects(blocked.acquire(() => {}), /lease unavailable/);
  await blocked.close();
});

test('concurrent missing-lease acquisition grants ownership to exactly one process', async () => {
  const database = createLeaseDatabase();
  const first = createLeaseRemote(database, 'concurrent');
  const second = createLeaseRemote(database, 'concurrent');
  const results = await Promise.allSettled([first.acquire(() => {}), second.acquire(() => {})]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  await first.close();
  await second.close();
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
  const db = createLeaseDatabase();
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
  const db = createLeaseDatabase();
  const collection = db.collection();
  const originalUpdate = collection.updateOne.bind(collection);
  collection.updateOne = async (filter, update) => {
    if (filter.$or) return originalUpdate(filter, update);
    renewals++;
    if (renewals === 1) return new Promise((_resolve, reject) => { failOldRenewal = reject; });
    return originalUpdate(filter, update);
  };
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
  let lost = 0;
  const db = createLeaseDatabase();
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
  assert.equal(db.state.lease.expiresAt.getTime(), 90_000);
  t.mock.timers.tick(20_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lost, 1);
  await remote.close();
});
