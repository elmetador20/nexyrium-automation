const MB = 1024 * 1024;

function toMegabytes(bytes) {
  return Math.round((bytes / MB) * 10) / 10;
}

function snapshot(memoryUsage = process.memoryUsage()) {
  return {
    rssMb: toMegabytes(memoryUsage.rss),
    heapUsedMb: toMegabytes(memoryUsage.heapUsed),
    heapTotalMb: toMegabytes(memoryUsage.heapTotal),
    externalMb: toMegabytes(memoryUsage.external),
    arrayBuffersMb: toMegabytes(memoryUsage.arrayBuffers || 0),
  };
}

function createMemoryMonitor({ logger, intervalMs = 60_000, memoryUsage = () => process.memoryUsage(), timers = globalThis }) {
  let timer = null;

  function log(reason) {
    logger.info('Process memory usage', { reason, ...snapshot(memoryUsage()) });
  }

  function start() {
    if (timer) return;
    log('startup');
    timer = timers.setInterval(() => log('interval'), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    timers.clearInterval(timer);
    timer = null;
  }

  return { start, stop, snapshot: () => snapshot(memoryUsage()) };
}

module.exports = { createMemoryMonitor, snapshot };
