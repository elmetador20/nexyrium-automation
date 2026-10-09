const { describeError } = require('./lib/logger');

function createApplication({ deps = require('./container'), config = require('./config/env').env,
  log = require('./lib/logger'), timers = require('./services/inactivity-timer'),
  memoryMonitorFactory = require('./lib/memory-monitor').createMemoryMonitor,
  apiFactory = require('./api/server').createApiServer,
  monitorFactory = require('./services/database-monitor').createDatabaseMonitor } = {}) {
  let server;
  let monitor;
  let booting;
  let stopping;
  let stopped = false;
  let workerStarted = false;
  let whatsappStarted = false;
  let memoryMonitor;

  function bootstrap() {
    booting ??= (async () => {
      log.info('Starting WhatsApp lead automation');
      // HTTP liveness is available while SQL/Mongo/WhatsApp are still connecting.
      server = await apiFactory(config.PORT).start();
      if (stopped) { server.close(); return; }
      memoryMonitor = memoryMonitorFactory({ logger: log });
      memoryMonitor.start();
      // Resolve the processor only when an inactivity timer actually fires.
      // Constructing it here also constructs Google Sheets synchronously, so a
      // missing Render Secret File used to reject bootstrap after HTTP started.
      timers.setProcessor((phone) => deps.conversationProcessor.processConversation(phone));
      monitor = monitorFactory({
        prisma: deps.prisma, logger: log,
        onReady: async () => {
          if (stopped) return;
          try {
            deps.retryWorker.start();
            workerStarted = true;
          } catch (error) {
            log.error('Retry worker initialization failed; database monitor will retry', {
              error: describeError(error),
            });
            throw error;
          }
          // Do not consume inbound bot events before the lead database is usable.
          try {
            whatsappStarted = true;
            await deps.whatsapp.initialize();
          } catch (error) {
            log.error('WhatsApp initialization request failed; lifecycle will retry', {
              error: describeError(error),
            });
            throw error;
          }
        },
      });
      monitor.start();
      log.info('HTTP ready; waiting for database and WhatsApp initialization');
    })();
    return booting;
  }

  function shutdown() {
    stopped = true;
    stopping ??= (async () => {
      log.info('Shutting down');
      monitor?.stop();
      memoryMonitor?.stop();
      // Do not resolve a lazy optional dependency merely to stop it. If its
      // setup failed (for example, a missing Google Secret File), resolving it
      // here used to throw a second error and hide the original failure.
      if (workerStarted) deps.retryWorker.stop();
      timers.clearAll();
      if (whatsappStarted) {
        await deps.whatsapp.close().catch(() => log.warn('WhatsApp shutdown incomplete'));
      }
      await deps.prisma.$disconnect().catch(() => log.warn('Lead database shutdown incomplete'));
      if (server) await new Promise((resolve) => server.close(resolve));
    })();
    return stopping;
  }
  return { bootstrap, shutdown };
}

let app;
const instance = () => (app ??= createApplication());
module.exports = {
  createApplication,
  bootstrap: () => instance().bootstrap(),
  shutdown: () => instance().shutdown(),
};
