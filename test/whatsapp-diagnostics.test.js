const test = require('node:test');
const assert = require('node:assert/strict');
const { getChromiumMemory } = require('../src/lib/whatsapp-diagnostics');

test('Chromium memory diagnostic sums browser and renderer descendants', () => {
  const stats = {
    '/proc/100/stat': '100 (chrome) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
    '/proc/101/stat': '101 (renderer) S 100 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
    '/proc/102/stat': '102 (gpu) S 101 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
    '/proc/100/status': 'Name: chrome\nVmRSS:       1024 kB\n',
    '/proc/101/status': 'Name: renderer\nVmRSS:       2048 kB\n',
    '/proc/102/status': 'Name: gpu\nVmRSS:       3072 kB\n',
  };
  const fsApi = {
    readdirSync() { return ['100', '101', '102', 'not-a-pid']; },
    readFileSync(file) { return stats[file]; },
  };
  assert.deepEqual(getChromiumMemory(100, fsApi), {
    chromiumPid: 100,
    chromiumProcessCount: 3,
    chromiumRssMb: 1,
    chromiumTreeRssMb: 6,
  });
});
