const { Client } = require('whatsapp-web.js');
const { PersistentRemoteAuth } = require('./remote-auth');
const { createRemoteStore } = require('./remote-store');
const { getPuppeteerChromeInfo, verifyPuppeteerChrome } = require('../../lib/puppeteer-browser');
const { safeErrorDetails, safeEventValue } = require('../../lib/whatsapp-diagnostics');

/** One serialized browser lifecycle plus an external lease across redeploys. */
function createWhatsAppClient({ config, logger, createEventHandler,
  ClientClass = Client, AuthClass = PersistentRemoteAuth, remoteStore = createRemoteStore({ config, logger }),
  getChromeInfo = getPuppeteerChromeInfo, verifyChrome = verifyPuppeteerChrome }) {
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

  function transition(nextState, reason) {
    const previous = state;
    state = nextState;
    if (previous !== nextState) logger.info('WhatsApp state transition', {
      from: previous, to: nextState, reason: safeEventValue(reason),
    });
  }

  function status() {
    return { state, connected: state === 'ready' && !cleaning, qrRequired: !!currentQr,
      remoteSessionSavedAt: remoteStore.getLastSavedAt(), authStrategy: 'RemoteAuth' };
  }

  function scheduleRetry() {
    if (!desired || retryTimer) return;
    transition('reconnecting', 'retry scheduled');
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

  function recover(c, message, logMessage = true) {
    if (c !== client || cleaning) return;
    transition('disconnected', message);
    currentQr = null;
    if (logMessage) logger.warn(message);
    enqueue(async () => {
      if (c !== client) return;
      await stopClient();
      scheduleRetry();
    }).catch(() => scheduleRetry());
  }

  function watchBrowser(c) {
    if (c !== client || c.browserRecoveryAttached || !c.pupBrowser) return;
    c.browserRecoveryAttached = true;
    c.pupBrowser.once('disconnected', () => {
      logger.warn('WhatsApp browser disconnected', { state });
      recover(c, 'browser disconnected');
    });
    c.pupPage?.once?.('close', () => {
      logger.warn('WhatsApp browser page closed', { state });
    });
  }

  async function startAttempt() {
    if (!desired) return;
    if (client && ['initializing', 'qr_required', 'authenticated', 'ready'].includes(state)) return client;
    await stopClient();
    transition('initializing', 'initialization started');
    logger.info('Initializing WhatsApp');
    try {
      await remoteStore.acquire(() => {
        if (client) recover(client, 'WhatsApp remote storage/lease interrupted');
      });
      if (!desired) { await remoteStore.release(); return; }
      const chrome = getChromeInfo();
      logger.info('Puppeteer Chrome runtime', {
        puppeteerVersion: chrome.puppeteerVersion,
        expectedChromeRevision: chrome.expectedChromeRevision,
        chromeExecutable: chrome.executablePath,
        chromeExecutableExists: chrome.exists,
      });
      logger.info(`Chrome executable exists: ${chrome.exists}`);
      verifyChrome();
      const authStrategy = new AuthClass({
        clientId: config.clientId, dataPath: config.dataPath,
        store: remoteStore.adapter, backupSyncIntervalMs: config.backupIntervalMs,
      }, logger);
      const c = new ClientClass({
        authStrategy,
        puppeteer: {
          headless: true,
          executablePath: chrome.executablePath,
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
        transition('qr_required', 'qr event');
        logger.info('WhatsApp event: qr', { state, qrAvailable: true });
        logger.info('WhatsApp QR required; use the protected QR endpoint');
      });
      c.on('authenticated', () => {
        if (c !== client || cleaning) return;
        currentQr = null;
        transition('authenticated', 'authenticated event');
        logger.info('WhatsApp event: authenticated', { state });
        clearTimeout(watchdog);
        watchdog = setTimeout(() => recover(c, 'WhatsApp authenticated but readiness timed out'), 180_000);
        logger.info('WhatsApp authenticated');
      });
      c.on('ready', () => {
        if (c !== client || cleaning) return;
        clearTimeout(watchdog);
        transition('ready', 'ready event');
        logger.info('WhatsApp event: ready', { state });
        attempt = 0;
        currentQr = null;
        watchBrowser(c);
        logger.info('WhatsApp ready');
      });
      c.on('remote_session_saved', () => {
        if (c === client) logger.info('WhatsApp first remote session backup confirmed');
      });
      c.on('auth_failure', (error) => {
        logger.warn('WhatsApp event: auth_failure', { state, error: safeErrorDetails(error) });
        recover(c, 'authentication failure; retrying restoration');
      });
      c.on('disconnected', (reason) => {
        // Do not log arbitrary library payloads or authentication material.
        logger.warn('WhatsApp event: disconnected', { state, reason: safeEventValue(reason) });
        if (reason === 'LOGOUT') {
          // Join the upstream cleanup before releasing the remote lease.
          c.authStrategy.logout().catch(() => logger.warn('Invalidated session cleanup failed'));
        }
        recover(c, reason === 'LOGOUT' ? 'logged out; a new QR may be required' : 'disconnected');
      });
      c.on('error', (error) => {
        logger.warn('WhatsApp event: client_error', { state, error: safeErrorDetails(error) });
        recover(c, 'client error');
      });
      c.on('change_state', (value) => {
        if (c !== client || cleaning) return;
        logger.info('WhatsApp event: change_state', { state, whatsappState: safeEventValue(value) });
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
          recover(c, 'WhatsApp initialization failed', false);
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
    return enqueue(async () => { await stopClient(); transition('stopped', 'destroy requested'); });
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
