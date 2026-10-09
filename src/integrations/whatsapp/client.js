const { Client } = require('whatsapp-web.js');
const { PersistentRemoteAuth } = require('./remote-auth');
const { createRemoteStore } = require('./remote-store');

function safeErrorDetails(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(error),
    stack: typeof error?.stack === 'string' ? error.stack : undefined,
  };
}

/** One serialized browser lifecycle plus an external lease across redeploys. */
function createWhatsAppClient({ config, logger, createEventHandler,
  ClientClass = Client, AuthClass = PersistentRemoteAuth, remoteStore = createRemoteStore({ config, logger }) }) {
  let client = null;
  let currentQr = null;
  let state = 'stopped';
  let desired = false;
  let queue = Promise.resolve();
  let starting = null;
  let reconnecting = null;
  let retryTimer = null;
  let watchdog = null;
  let attempt = 0;
  let cleaning = false;

  function enqueue(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }

  function status() {
    return { state, connected: state === 'ready' && !cleaning, qrRequired: !!currentQr,
      remoteSessionSavedAt: remoteStore.getLastSavedAt(), authStrategy: 'RemoteAuth' };
  }

  function scheduleRetry() {
    if (!desired || retryTimer) return;
    state = 'reconnecting';
    const delayMs = Math.min(60_000, 5000 * (2 ** Math.min(attempt++, 4)));
    logger.info('Reconnecting WhatsApp', { delayMs });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      initialize().catch(() => {});
    }, delayMs);
    retryTimer.unref?.();
  }

  async function stopClient() {
    clearTimeout(watchdog);
    watchdog = null;
    const old = client;
    currentQr = null;
    if (old) {
      cleaning = true;
      // Stop backup hooks before closing Chrome, then wait for profile cleanup.
      await old.authStrategy.destroy().catch(() => {});
      await old.authStrategy.logoutPromise?.catch(() => {});
      await old.destroy().catch(() => {});
      // A launch/restore can still be in flight before pupBrowser is assigned.
      // Don't release the lease or launch another client until it has stopped.
      const deadline = Date.now() + 35_000;
      while (!old.initializationSettled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await old.destroy().catch(() => {});
      }
      if (!old.initializationSettled) {
        cleaning = false;
        throw new Error('WhatsApp previous initialization has not stopped');
      }
    }
    client = null;
    cleaning = false;
    await remoteStore.release();
  }

  function recover(c, message) {
    if (c !== client || cleaning) return;
    state = 'disconnected';
    currentQr = null;
    logger.warn(message);
    enqueue(async () => {
      if (c !== client) return;
      await stopClient();
      scheduleRetry();
    }).catch(() => scheduleRetry());
  }

  function watchBrowser(c) {
    if (c !== client || c.browserRecoveryAttached || !c.pupBrowser) return;
    c.browserRecoveryAttached = true;
    c.pupBrowser.once('disconnected', () => recover(c, 'WhatsApp browser disconnected'));
  }

  async function startAttempt() {
    if (!desired) return;
    if (client && ['initializing', 'qr_required', 'authenticated', 'ready'].includes(state)) return client;
    await stopClient();
    state = 'initializing';
    logger.info('Initializing WhatsApp');
    try {
      await remoteStore.acquire(() => {
        if (client) recover(client, 'WhatsApp remote storage/lease interrupted');
      });
      if (!desired) { await remoteStore.release(); return; }
      const authStrategy = new AuthClass({
        clientId: config.clientId, dataPath: config.dataPath,
        store: remoteStore.adapter, backupSyncIntervalMs: config.backupIntervalMs,
      }, logger);
      const c = new ClientClass({
        authStrategy,
        puppeteer: {
          headless: true,
          ...(config.executablePath ? { executablePath: config.executablePath } : {}),
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
          dumpio: false,
        },
        takeoverOnConflict: false,
      });
      client = c;
      createEventHandler().register(c);
      c.on('qr', (qr) => {
        if (c !== client || cleaning) return;
        clearTimeout(watchdog);
        currentQr = qr;
        state = 'qr_required';
        logger.info('WhatsApp QR required; use the protected QR endpoint');
      });
      c.on('authenticated', () => {
        if (c !== client || cleaning) return;
        currentQr = null;
        state = 'authenticated';
        clearTimeout(watchdog);
        watchdog = setTimeout(() => recover(c, 'WhatsApp authenticated but readiness timed out'), 180_000);
        logger.info('WhatsApp authenticated');
      });
      c.on('ready', () => {
        if (c !== client || cleaning) return;
        clearTimeout(watchdog);
        state = 'ready';
        attempt = 0;
        currentQr = null;
        watchBrowser(c);
        logger.info('WhatsApp ready');
      });
      c.on('remote_session_saved', () => {
        if (c === client) logger.info('WhatsApp first remote session backup confirmed');
      });
      c.on('auth_failure', () => recover(c, 'WhatsApp authentication failure; retrying restoration'));
      c.on('disconnected', (reason) => {
        // Do not log arbitrary library payloads or authentication material.
        if (reason === 'LOGOUT') {
          // Join the upstream cleanup before releasing the remote lease.
          c.authStrategy.logout().catch(() => logger.warn('Invalidated session cleanup failed'));
        }
        recover(c, reason === 'LOGOUT' ? 'WhatsApp logged out; a new QR may be required' : 'WhatsApp disconnected');
      });
      c.on('error', () => recover(c, 'WhatsApp client error'));
      c.on('change_state', (value) => {
        if (c !== client || cleaning) return;
        if (['TIMEOUT', 'OPENING'].includes(value)) {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => recover(c, 'WhatsApp network recovery timed out'), 120_000);
        } else if (value === 'CONNECTED') clearTimeout(watchdog);
      });
      watchdog = setTimeout(() => recover(c, 'WhatsApp initialization timed out'), 180_000);
      // initialize() may wait on WhatsApp indefinitely. Completion and recovery
      // are event-driven; HTTP and lifecycle queue are not blocked by QR scanning.
      c.initializationSettled = false;
      Promise.resolve().then(() => c.initialize()).then(() => watchBrowser(c))
        .catch((error) => {
          // Keep the lifecycle retry, but do not discard the Puppeteer,
          // RemoteAuth, or network exception that explains the failure.
          logger.warn('WhatsApp initialization failed', safeErrorDetails(error));
          recover(c, 'WhatsApp initialization failed');
        })
        .finally(() => { c.initializationSettled = true; });
      return c;
    } catch (error) {
      logger.warn('WhatsApp startup/storage unavailable; will retry', safeErrorDetails(error));
      await stopClient();
      scheduleRetry();
    }
  }

  function initialize() {
    desired = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!starting) {
      starting = enqueue(startAttempt).finally(() => { starting = null; });
    }
    return starting;
  }

  function reconnect() {
    desired = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!reconnecting) {
      reconnecting = enqueue(async () => {
        await stopClient();
        await startAttempt();
      }).finally(() => { reconnecting = null; });
    }
    return reconnecting;
  }

  function destroy() {
    desired = false;
    clearTimeout(retryTimer);
    retryTimer = null;
    return enqueue(async () => { await stopClient(); state = 'stopped'; });
  }

  function resetSession() {
    desired = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    return enqueue(async () => {
      await stopClient();
      await remoteStore.reset();
      await startAttempt();
    });
  }

  async function close() { await destroy(); await remoteStore.close(); }
  function getClient() {
    if (!client) throw new Error('WhatsApp client not initialized');
    return client;
  }
  return { initialize, reconnect, destroy, close, resetSession, getClient, getQr: () => currentQr, getStatus: status };
}

module.exports = { createWhatsAppClient };
