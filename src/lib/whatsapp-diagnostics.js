const { describeError } = require('./logger');
const fs = require('node:fs');

function sanitizeText(value) {
  return String(value)
    .replace(/(?:mongodb(?:\+srv)?|mysql):\/\/[^\s"']+/gi, '[REDACTED CONNECTION STRING]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .slice(0, 1000);
}

function safeErrorDetails(error) {
  if (error && typeof error === 'object') return describeError(error);
  return { name: 'Error', message: sanitizeText(error) };
}

function safeEventValue(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (value === undefined || value === null) return value ?? null;
  return typeof value;
}

function readProcStatParent(contents) {
  const endOfCommand = contents.lastIndexOf(')');
  if (endOfCommand < 0) return null;
  const fields = contents.slice(endOfCommand + 2).split(' ');
  const parent = Number(fields[1]);
  return Number.isInteger(parent) && parent > 0 ? parent : null;
}

function readProcRssMb(pid, fsApi = fs) {
  try {
    const status = fsApi.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return match ? Math.round((Number(match[1]) / 1024) * 10) / 10 : null;
  } catch {
    return null;
  }
}

/**
 * Return the RSS of Chromium's browser process and all of its descendants.
 * Node's process.memoryUsage() excludes these child processes, which are often
 * the largest part of a whatsapp-web.js service's Render memory footprint.
 *
 * @param {number|null|undefined} rootPid Puppeteer's browser child PID
 * @param {object} fsApi injectable fs API for tests
 */
function getChromiumMemory(rootPid, fsApi = fs) {
  const pid = Number(rootPid);
  if (!Number.isInteger(pid) || pid <= 0 || process.platform !== 'linux') {
    return { chromiumPid: null, chromiumProcessCount: 0, chromiumRssMb: null, chromiumTreeRssMb: null };
  }

  let entries;
  try {
    entries = fsApi.readdirSync('/proc');
  } catch {
    return { chromiumPid: pid, chromiumProcessCount: 0, chromiumRssMb: null, chromiumTreeRssMb: null };
  }

  const parentByPid = new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fsApi.readFileSync(`/proc/${entry}/stat`, 'utf8');
      const parent = readProcStatParent(stat);
      if (parent) parentByPid.set(Number(entry), parent);
    } catch {
      // Processes can exit between /proc enumeration and inspection.
    }
  }

  const descendants = [pid];
  for (let index = 0; index < descendants.length; index++) {
    const parent = descendants[index];
    for (const [child, childParent] of parentByPid) {
      if (childParent === parent && !descendants.includes(child)) descendants.push(child);
    }
  }

  const rssValues = descendants.map((descendant) => readProcRssMb(descendant, fsApi)).filter((value) => value !== null);
  return {
    chromiumPid: pid,
    chromiumProcessCount: descendants.length,
    chromiumRssMb: readProcRssMb(pid, fsApi),
    chromiumTreeRssMb: rssValues.length > 0 ? Math.round(rssValues.reduce((sum, value) => sum + value, 0) * 10) / 10 : null,
  };
}

function getBrowserMemory(browser, fsApi = fs) {
  let pid = null;
  try { pid = browser?.process?.()?.pid || null; } catch { /* Browser may be closing. */ }
  return getChromiumMemory(pid, fsApi);
}

module.exports = { safeErrorDetails, safeEventValue, getChromiumMemory, getBrowserMemory };
