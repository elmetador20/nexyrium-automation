const { RemoteAuth } = require('whatsapp-web.js');
const fs = require('node:fs');
const unzipper = require('unzipper');

/** Reviewed extension points of pinned whatsapp-web.js 1.34.7 RemoteAuth. */
class PersistentRemoteAuth extends RemoteAuth {
  constructor(options, logger) {
    super(options);
    this.logger = logger;
    this.stopped = false;
    this.savePromise = null;
    this.readyTask = null;
    this.initialTimer = null;
    this.finishDelay = null;
    this.newAuthentication = false;
    this.saved = false;
    this.logoutPromise = null;
  }

  async beforeBrowserInitialized() {
    if (this.stopped) throw new Error('WhatsApp initialization cancelled');
    this.logger.info('Restoring WhatsApp session from remote storage if available');
    await super.beforeBrowserInitialized();
    if (this.stopped) throw new Error('WhatsApp initialization cancelled');
    this.logger.info('WhatsApp session profile prepared');
  }

  async onAuthenticationNeeded() {
    this.newAuthentication = true;
    // A stale archive must be replaced after a valid new QR login.
    return super.onAuthenticationNeeded();
  }

  async unCompressSession(archivePath) {
    const source = fs.createReadStream(archivePath);
    const extraction = unzipper.Extract({ path: this.userDataDir, concurrency: 4 });
    // Upstream waits for "finish"; unzipper documents "close"/.promise() as
    // completion of actual extracted file writes, which can happen later.
    const completed = extraction.promise();
    source.on('error', (error) => extraction.destroy(error));
    source.pipe(extraction);
    try { await completed; }
    finally { source.destroy(); }
    await fs.promises.unlink(archivePath);
  }

  afterAuthReady() {
    this.readyTask ??= this.prepareBackups().catch(() => {
      if (!this.stopped) {
        this.logger.warn('WhatsApp initial remote backup failed; will retry');
        this.scheduleBackups();
      }
    });
    return this.readyTask;
  }

  async prepareBackups() {
    const exists = await this.store.sessionExists({ session: this.sessionName });
    if (this.stopped) return;
    this.saved = exists && !this.newAuthentication;
    if (!this.saved) {
      // Upstream requires at least one minute for the first profile to stabilize.
      await new Promise((resolve) => {
        this.finishDelay = resolve;
        this.initialTimer = setTimeout(resolve, 60_000);
      });
      this.initialTimer = null;
      this.finishDelay = null;
      if (this.stopped) return;
      await this.storeRemoteSession({ emit: true });
    }
    this.scheduleBackups();
  }

  scheduleBackups() {
    if (this.stopped || this.backupSync) return;
    this.backupSync = setInterval(() => {
      this.storeRemoteSession({ emit: !this.saved }).catch(() => {
        this.logger.warn('WhatsApp remote backup failed; keeping last saved session');
      });
    }, this.backupSyncIntervalMs);
    this.backupSync.unref?.();
  }

  storeRemoteSession(options) {
    if (this.stopped) return Promise.resolve();
    if (!this.savePromise) {
      this.savePromise = this.isValidPath(this.userDataDir).then((exists) => {
        if (!exists || this.stopped) throw new Error('WhatsApp profile not ready for backup');
        return super.storeRemoteSession(options);
      }).then(() => {
        this.saved = true;
      }).finally(() => { this.savePromise = null; });
    }
    return this.savePromise;
  }

  async destroy() {
    this.stopped = true;
    clearTimeout(this.initialTimer);
    this.finishDelay?.();
    clearInterval(this.backupSync);
    this.backupSync = null;
    await this.savePromise?.catch(() => {});
  }

  // Client calls disconnect() for non-accepted connection states as well as
  // invalidations. Preserve the archive here; only explicit logout deletes it.
  async disconnect() { await this.destroy(); }

  logout() {
    this.logoutPromise ??= (async () => {
      await this.destroy();
      await super.disconnect();
    })();
    return this.logoutPromise;
  }
}

module.exports = { PersistentRemoteAuth };
