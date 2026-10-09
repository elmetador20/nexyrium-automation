const test = require('node:test');
const assert = require('node:assert/strict');
const { createRetryWorker } = require('../src/services/retry-worker.service');

test('retry worker creates one schedule and skips an overlapping async tick', async () => {
  let scheduledCallback;
  let resolveFirstQuery;
  let pendingQueryCalls = 0;
  const logs = [];
  const cronApi = {
    schedule(_schedule, callback) {
      scheduledCallback = callback;
      return { stop() {} };
    },
  };
  const worker = createRetryWorker({
    leadRepo: {
      async findPendingWithRetry(status) {
        if (status === 'AI_PENDING' && pendingQueryCalls++ === 0) {
          return new Promise((resolve) => { resolveFirstQuery = resolve; });
        }
        return [];
      },
      async findAssignmentPending() { return []; },
    },
    messageRepo: {},
    leadService: {},
    extractor: {},
    assignmentService: {},
    logger: { info() {}, error() {}, warn() {}, debug(message) { logs.push(message); } },
    config: { retrySchedule: '*/5 * * * *' },
    cronApi,
  });

  worker.start();
  worker.start();
  const first = scheduledCallback();
  await new Promise((resolve) => setImmediate(resolve));
  await scheduledCallback();
  assert.ok(logs.includes('Retry worker tick skipped; previous tick still running'));
  resolveFirstQuery([]);
  await first;
  worker.stop();
  assert.equal(pendingQueryCalls, 1);
});
