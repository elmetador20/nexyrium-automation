const { RemoteAuth } = require('whatsapp-web.js');
const fs = require('node:fs');
const unzipper = require('unzipper');
const { safeErrorDetails } = require('../../lib/whatsapp-diagnostics');

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
    this.logoutInProgress = false;
  }

  async beforeBrowserInitialized() {
    if (this.stopped) throw new Error('WhatsApp initialization cancelled');
    this.logger.info('Restoring WhatsApp session from remote storage if available');
    try {
      await super.beforeBrowserInitialized();
    } catch (error) {
      this.logger.warn('WhatsApp session restoration failed', { error: safeErrorDetails(error) });
      throw error;
    }
    if (this.stopped) throw new Error('WhatsApp initialization cancelled');
    this.logger.info('WhatsApp session profile prepared');
  }

  async onAuthenticationNeeded() {
    this.newAuthentication = true;
    this.logger.info('WhatsApp authentication is required; awaiting QR scan');
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
    this.readyTask ??= this.prepareBackups().catch((error) => {
      if (!this.stopped && !this.logoutInProgress) {
        this.logger.warn('WhatsApp initial remote backup failed; will retry', { error: safeErrorDetails(error) });
        this.scheduleBackups();
      }
    });
    return this.readyTask;
  }

  async prepareBackups() {
    if (this.logoutInProgress) return;
    const exists = await this.store.sessionExists({ session: this.sessionName });
    if (this.stopped || this.logoutInProgress) return;
    this.saved = exists && !this.newAuthentication;
    if (!this.saved) {
      // Upstream requires at least one minute for the first profile to stabilize.
      await new Promise((resolve) => {
        this.finishDelay = resolve;
        this.initialTimer = setTimeout(resolve, 60_000);
      });
      this.initialTimer = null;
      this.finishDelay = null;
      if (this.stopped || this.logoutInProgress) return;
      await this.storeRemoteSession({ emit: true });
    }
    this.scheduleBackups();
  }

  scheduleBackups() {
    if (this.stopped || this.logoutInProgress || this.backupSync) return;
    this.backupSync = setInterval(() => {
      this.storeRemoteSession({ emit: !this.saved }).catch((error) => {
        this.logger.warn('WhatsApp remote backup failed; keeping last saved session', {
          error: safeErrorDetails(error),
        });
      });
    }, this.backupSyncIntervalMs);
    this.backupSync.unref?.();
  }

  storeRemoteSession(options) {
    if (this.stopped || this.logoutInProgress) return Promise.resolve();
    if (!this.savePromise) {
      this.savePromise = this.isValidPath(this.userDataDir).then((exists) => {
        if (!exists || this.stopped || this.logoutInProgress) throw new Error('WhatsApp profile not ready for backup');
        return super.storeRemoteSession(options);
      }).then(() => {
        this.saved = true;
      }).finally(() => { this.savePromise = null; });
    }
    return this.savePromise;
  }

  async destroy() {
    this.stopped = true;
    await this.stopBackupTasks();
  }

  async stopBackupTasks() {
    clearTimeout(this.initialTimer);
    this.finishDelay?.();
    this.initialTimer = null;
    this.finishDelay = null;
    clearInterval(this.backupSync);
    this.backupSync = null;
    await this.savePromise?.catch(() => {});
  }

  // Client calls disconnect() for non-accepted connection states as well as
  // invalidations. Preserve the archive here; only explicit logout deletes it.
  async disconnect() { await this.destroy(); }

  logout() {
    this.logoutPromise ??= (async () => {
      // whatsapp-web.js calls logout() from its post_logout frame handler and
      // immediately calls beforeBrowserInitialized() again on the same auth
      // strategy. Do not leave `stopped` set across that supported re-login
      // path; destroy() is reserved for the application-owned shutdown path.
      this.logoutInProgress = true;
      try {
        await this.stopBackupTasks();
        await super.disconnect();
      } finally {
        this.logoutInProgress = false;
        this.stopped = false;
      }
    })();
    return this.logoutPromise;
  }
}

module.exports = { PersistentRemoteAuth };
