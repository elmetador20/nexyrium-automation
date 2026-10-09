const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mongoosePackage = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const { safeErrorDetails } = require('../../lib/whatsapp-diagnostics');

/** Supported MongoStore, with the ZIP path bridge required by wwebjs 1.34.7. */
function createRemoteStore({ config, logger, mongoose = new mongoosePackage.Mongoose(), Store = MongoStore }) {
  let connecting = null;
  let store;
  let heartbeat;
  let leaseHeld = false;
  let leaseGeneration = 0;
  let lostHandler = () => {};
  let lastSavedAt = null;
  const owner = randomUUID();
  const session = `RemoteAuth-${config.clientId}`;
  const leaseMs = 90_000;
  const leases = () => mongoose.connection.db.collection('whatsapp_session_leases');

  // No driver error bodies: they can contain URIs or auth details.
  mongoose.connection.on('error', () => logger.warn('WhatsApp session database connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('WhatsApp session database disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('WhatsApp session database reconnected'));

  async function connect() {
    if (mongoose.connection.readyState === 1) return;
    if (!connecting) {
      logger.info('WhatsApp session database connection starting');
      connecting = mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000,
        socketTimeoutMS: 20_000, maxPoolSize: 3, bufferCommands: false,
      }).then(() => {
        store ??= new Store({ mongoose });
        logger.info('WhatsApp session database connected');
      }).catch((error) => {
        logger.warn('WhatsApp session database connection failed', { error: safeErrorDetails(error) });
        throw error;
      }).finally(() => { connecting = null; });
    }
    await connecting;
  }

  async function acquire(onLost) {
    logger.info('WhatsApp session lease acquisition started');
    try {
      await connect();
    } catch (error) {
      logger.warn('WhatsApp session lease acquisition failed', { error: safeErrorDetails(error) });
      throw new Error('WhatsApp session lease unavailable');
    }
    lostHandler = onLost;
    const now = new Date();
    try {
      const result = await leases().updateOne({
        _id: session, $or: [{ owner }, { expiresAt: { $lte: now } }],
      }, { $set: { owner, expiresAt: new Date(now.getTime() + leaseMs) } }, { upsert: true });
      if (!result.matchedCount && !result.upsertedCount) throw new Error('LEASE_BUSY');
    } catch (error) {
      logger.warn('WhatsApp session lease acquisition failed', { error: safeErrorDetails(error) });
      throw new Error('WhatsApp session lease unavailable');
    }
    leaseHeld = true;
    logger.info('WhatsApp session lease acquired');
    const generation = ++leaseGeneration;
    clearInterval(heartbeat);
    let renewing = false;
    heartbeat = setInterval(async () => {
      if (renewing || !leaseHeld || generation !== leaseGeneration) return;
      renewing = true;
      try {
        const result = await leases().updateOne({ _id: session, owner, expiresAt: { $gt: new Date() } }, {
          $set: { expiresAt: new Date(Date.now() + leaseMs) },
        });
        if (!result.matchedCount) throw new Error('LEASE_LOST');
      } catch (error) {
        // A released lease's pending heartbeat must not stop a newer client.
        if (generation !== leaseGeneration || !leaseHeld) return;
        leaseHeld = false;
        clearInterval(heartbeat);
        logger.warn('WhatsApp session lease lost; stopping this client', { error: safeErrorDetails(error) });
        lostHandler();
      } finally { renewing = false; }
    }, 20_000);
    heartbeat.unref?.();
  }

  async function assertLease() {
    if (!leaseHeld || !await leases().findOne({ _id: session, owner, expiresAt: { $gt: new Date() } })) {
      throw new Error('WhatsApp session lease unavailable');
    }
  }

  const adapter = {
    async sessionExists(options) {
      await assertLease();
      return store.sessionExists(options);
    },
    async extract(options) {
      await assertLease();
      logger.info('WhatsApp remote session restore started');
      // MongoStore 1.1.0 doesn't handle errors on both piped streams. Use the same
      // supported GridFS format with pipeline so a failed download cannot crash Node.
      const { pipeline } = require('node:stream/promises');
      const { createWriteStream } = require('node:fs');
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: `whatsapp-${options.session}`,
      });
      try {
        await pipeline(bucket.openDownloadStreamByName(`${options.session}.zip`), createWriteStream(options.path, { mode: 0o600 }));
      } catch (error) {
        logger.warn('WhatsApp remote session restore failed', { error: safeErrorDetails(error) });
        throw error;
      }
      const file = await mongoose.connection.db.collection(`whatsapp-${options.session}.files`)
        .findOne({ filename: `${options.session}.zip` }, { sort: { uploadDate: -1 }, projection: { uploadDate: 1 } });
      lastSavedAt = file?.uploadDate?.toISOString() || null;
      logger.info('WhatsApp remote session archive downloaded');
    },
    async save(options) {
      await assertLease();
      logger.info('WhatsApp remote session backup started');
      const source = path.resolve(config.dataPath, `${options.session}.zip`);
      const target = path.resolve(`${options.session}.zip`);
      if (source !== target) await fs.copyFile(source, target);
      await fs.chmod(target, 0o600);
      try {
        await store.save(options);
        lastSavedAt = new Date().toISOString();
        logger.info('WhatsApp session saved remotely');
      } catch (error) {
        logger.warn('WhatsApp remote session backup failed', { error: safeErrorDetails(error) });
        throw error;
      } finally {
        if (source !== target) await fs.rm(target, { force: true });
      }
    },
    async delete(options) {
      await assertLease();
      // Await all deletions: the published store's delete() starts unawaited tasks.
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `whatsapp-${options.session}` });
      const files = await bucket.find({ filename: `${options.session}.zip` }).toArray();
      await Promise.all(files.map((file) => bucket.delete(file._id)));
      lastSavedAt = null;
      logger.info('Invalidated WhatsApp session removed from remote storage');
    },
  };

  async function release() {
    const wasHeld = leaseHeld;
    leaseGeneration++;
    clearInterval(heartbeat);
    if (mongoose.connection.readyState === 1) {
      await leases().deleteOne({ _id: session, owner }).catch(() => {});
    }
    leaseHeld = false;
    if (wasHeld) logger.info('WhatsApp session lease released');
  }

  async function close() {
    await release();
    await mongoose.disconnect();
  }

  async function reset() {
    await acquire(() => {});
    try { await adapter.delete({ session }); }
    finally { await release(); }
  }
  return { acquire, release, close, reset, adapter, getLastSavedAt: () => lastSavedAt };
}

module.exports = { createRemoteStore };
