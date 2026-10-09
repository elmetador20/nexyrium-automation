const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryMonitor, snapshot } = require('../src/lib/memory-monitor');

test('memory monitor reports bounded process metrics and schedules only once', () => {
  const logs = [];
  let intervalCallback;
  let cleared = 0;
  const timers = {
    setInterval(callback) { intervalCallback = callback; return { unref() {} }; },
    clearInterval() { cleared++; },
  };
  const memory = () => ({ rss: 512 * 1024 * 1024, heapUsed: 128 * 1024 * 1024,
    heapTotal: 256 * 1024 * 1024, external: 32 * 1024 * 1024, arrayBuffers: 8 * 1024 * 1024 });
  const monitor = createMemoryMonitor({ logger: { info(_message, meta) { logs.push(meta); } }, memoryUsage: memory, timers });
  monitor.start();
  monitor.start();
  intervalCallback();
  monitor.stop();
  monitor.stop();
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0], { reason: 'startup', rssMb: 512, heapUsedMb: 128, heapTotalMb: 256, externalMb: 32, arrayBuffersMb: 8 });
  assert.equal(cleared, 1);
  assert.deepEqual(snapshot(memory()), { rssMb: 512, heapUsedMb: 128, heapTotalMb: 256, externalMb: 32, arrayBuffersMb: 8 });
});
