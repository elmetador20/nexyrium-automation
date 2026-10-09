const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mongoosePackage = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const { safeErrorDetails } = require('../../lib/whatsapp-diagnostics');

const LEASE_MS = 90_000;
const HEARTBEAT_MS = 20_000;

/** Supported MongoStore, with the ZIP path bridge required by wwebjs 1.34.7. */
function createRemoteStore({ config, logger, mongoose = new mongoosePackage.Mongoose(), Store = MongoStore }) {
  let connecting = null;
  let store;
  let heartbeat;
  let leaseHeld = false;
  let leaseGeneration = 0;
  let lostHandler = () => {};
  let lastSavedAt = null;
  let leaseExpiresAt = null;
  const owner = randomUUID();
  const session = `RemoteAuth-${config.clientId}`;
  const leases = () => mongoose.connection.db.collection('whatsapp_session_leases');

  function leaseMetadata(extra = {}) {
    return { ownerId: owner, session, ...extra };
  }

  function dateValue(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function iso(value) {
    return dateValue(value)?.toISOString() || null;
  }

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
    logger.info('WhatsApp session lease acquisition started', leaseMetadata({ leaseMs: LEASE_MS }));
    let expiresAt;
    try {
      await connect();
      lostHandler = onLost;
      const now = new Date();
      expiresAt = new Date(now.getTime() + LEASE_MS);

      let acquired = false;
      try {
        await leases().insertOne({ _id: session, owner, expiresAt });
        acquired = true;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        // A duplicate key means a lease document exists. The conditional
        // update below is the ownership boundary: only this owner or an
        // already-expired lease may be changed.
      }

      if (!acquired) {
        const result = await leases().updateOne({
          _id: session,
          $or: [{ owner }, { expiresAt: { $lte: now } }],
        }, { $set: { owner, expiresAt } });
        acquired = result.matchedCount === 1;
      }

      if (!acquired) {
        const current = await leases().findOne(
          { _id: session },
          { projection: { owner: 1, expiresAt: 1 } },
        );
        const busy = new Error('LEASE_BUSY');
        busy.code = 'LEASE_BUSY';
        logger.warn('WhatsApp session lease busy', leaseMetadata({
          currentOwnerId: current?.owner || null,
          currentExpiresAt: iso(current?.expiresAt),
          requestedExpiresAt: expiresAt.toISOString(),
        }));
        throw busy;
      }
    } catch (error) {
      logger.warn('WhatsApp session lease acquisition failed', leaseMetadata({ error: safeErrorDetails(error) }));
      throw new Error('WhatsApp session lease unavailable');
    }
    leaseHeld = true;
    leaseExpiresAt = expiresAt;
    logger.info('WhatsApp session lease acquired', leaseMetadata({ expiresAt: expiresAt.toISOString() }));
    const generation = ++leaseGeneration;
    clearInterval(heartbeat);
    let renewing = false;
    heartbeat = setInterval(async () => {
      if (renewing || !leaseHeld || generation !== leaseGeneration) return;
      renewing = true;
      const now = new Date();
      const nextExpiresAt = new Date(now.getTime() + LEASE_MS);
      try {
        const result = await leases().updateOne({ _id: session, owner, expiresAt: { $gt: now } }, {
          $set: { expiresAt: nextExpiresAt },
        });
        if (!result.matchedCount) throw new Error('LEASE_LOST');
        leaseExpiresAt = nextExpiresAt;
        logger.info('WhatsApp session lease heartbeat succeeded', leaseMetadata({
          expiresAt: nextExpiresAt.toISOString(),
        }));
      } catch (error) {
        // A released lease's pending heartbeat must not stop a newer client.
        if (generation !== leaseGeneration || !leaseHeld) return;
        leaseHeld = false;
        clearInterval(heartbeat);
        logger.warn('WhatsApp session lease lost; stopping this client', leaseMetadata({
          expiresAt: iso(leaseExpiresAt), error: safeErrorDetails(error),
        }));
        try {
          await lostHandler();
        } catch (handlerError) {
          logger.warn('WhatsApp lease-loss recovery request failed', leaseMetadata({
            error: safeErrorDetails(handlerError),
          }));
        }
      } finally { renewing = false; }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
  }

  function isDuplicateKeyError(error) {
    return error?.code === 11000 || error?.code === '11000' || error?.code === 11001;
  }

  async function assertLease() {
    if (!leaseHeld || !await leases().findOne({ _id: session, owner, expiresAt: { $gt: new Date() } })) {
      logger.warn('WhatsApp session lease assertion failed', leaseMetadata({ expiresAt: iso(leaseExpiresAt) }));
      throw new Error('WhatsApp session lease unavailable');
    }
  }

  // Temporary read-only troubleshooting diagnostic. Deliberately project only
  // the lease id and expiry; the owner UUID is never fetched or returned.
  async function getLeaseDiagnostic() {
    await connect();
    const checkedAt = new Date();
    const lease = await leases().findOne(
      { _id: session },
      { projection: { _id: 1, expiresAt: 1 } },
    );
    const expiresAt = lease?.expiresAt instanceof Date
      ? lease.expiresAt
      : lease?.expiresAt ? new Date(lease.expiresAt) : null;
    return {
      leaseExists: !!lease,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null,
      active: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt > checkedAt : lease ? null : null,
      checkedAt: checkedAt.toISOString(),
    };
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
    const previousExpiresAt = leaseExpiresAt;
    leaseGeneration++;
    clearInterval(heartbeat);
    heartbeat = null;
    leaseExpiresAt = null;
    if (mongoose.connection.readyState !== 1) {
      leaseHeld = false;
      logger.warn('WhatsApp session lease release skipped; database disconnected', leaseMetadata({
        previousExpiresAt: iso(previousExpiresAt),
      }));
      return;
    }
    try {
      const result = await leases().deleteOne({ _id: session, owner });
      logger.info('WhatsApp session lease release completed', leaseMetadata({
        outcome: result.deletedCount === 1 ? 'released' : 'not_owner_or_missing',
        previousExpiresAt: iso(previousExpiresAt),
      }));
    } catch (error) {
      logger.warn('WhatsApp session lease release failed', leaseMetadata({
        previousExpiresAt: iso(previousExpiresAt), error: safeErrorDetails(error),
      }));
    } finally {
      leaseHeld = false;
    }
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
  return {
    acquire, release, close, reset, adapter, getLastSavedAt: () => lastSavedAt,
    getLeaseDiagnostic,
  };
}

module.exports = { createRemoteStore };
