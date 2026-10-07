/** Retry initial SQL connectivity while the HTTP service remains available. */
function createDatabaseMonitor({ prisma, logger, onReady, intervalMs = 30_000 }) {
  let timer = null;
  let stopped = true;
  let ready = false;
  let initialized = false;
  let checking = false;

  async function check() {
    if (stopped || checking) return;
    checking = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (stopped) return;
      if (!ready) logger.info('Lead database connected');
      ready = true;
      if (!initialized) { await onReady(); initialized = true; }
    } catch {
      if (ready || !initialized) logger.warn('Lead database unavailable; will retry');
      ready = false;
    } finally { checking = false; }
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    timer = setInterval(() => { void check(); }, intervalMs);
    timer.unref?.();
    void check();
  }
  function stop() { stopped = true; clearInterval(timer); }
  return { start, stop, check, isReady: () => ready };
}

module.exports = { createDatabaseMonitor };
