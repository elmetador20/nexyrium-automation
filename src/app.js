function createApplication({ deps = require('./container'), config = require('./config/env').env,
  log = require('./lib/logger'), timers = require('./services/inactivity-timer'),
  apiFactory = require('./api/server').createApiServer,
  monitorFactory = require('./services/database-monitor').createDatabaseMonitor } = {}) {
  let server;
  let monitor;
  let booting;
  let stopping;
  let stopped = false;

  function bootstrap() {
    booting ??= (async () => {
      log.info('Starting WhatsApp lead automation');
      // HTTP liveness is available while SQL/Mongo/WhatsApp are still connecting.
      server = await apiFactory(config.PORT).start();
      if (stopped) { server.close(); return; }
      timers.setProcessor(deps.conversationProcessor.processConversation);
      monitor = monitorFactory({
        prisma: deps.prisma, logger: log,
        onReady: async () => {
          if (stopped) return;
          deps.retryWorker.start();
          // Do not consume inbound bot events before the lead database is usable.
          await deps.whatsapp.initialize();
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
      deps.retryWorker.stop();
      timers.clearAll();
      await deps.whatsapp.close().catch(() => log.warn('WhatsApp shutdown incomplete'));
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
