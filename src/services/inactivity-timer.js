/**
 * Inactivity timer — triggers conversation processing after a silent period.
 *
 * Maintains a Map<PhoneNumber, Timeout>. Each incoming message resets the
 * timer; if no message arrives within the timeout window the registered
 * processor callback is invoked.
 *
 * @module services/inactivity-timer
 */

const { INACTIVITY_TIMEOUT_MS } = require('../config/constants');
const logger = require('../lib/logger');

/** @type {Map<string, NodeJS.Timeout>} */
const timers = new Map();

/** @type {(phone: string) => Promise<void>} | null */
let processorFn = null;

/**
 * Register the callback that runs when a timer expires.
 *
 * @param {(phone: string) => Promise<void>} fn
 */
function setProcessor(fn) {
  processorFn = fn;
}

/**
 * Reset (or create) the inactivity timer for a phone number.
 *
 * @param {string} phone
 */
function resetTimer(phone) {
  if (timers.has(phone)) {
    clearTimeout(timers.get(phone));
  }

  const timeout = setTimeout(() => {
    timers.delete(phone);
    if (processorFn) {
      processorFn(phone).catch((error) => {
        logger.error('Inactivity processor failed', { phone, error: error.message });
      });
    }
  }, INACTIVITY_TIMEOUT_MS);

  timers.set(phone, timeout);
  logger.debug('Inactivity timer reset', { phone, timeoutMs: INACTIVITY_TIMEOUT_MS });
}

/** @returns {number} Count of active timers. */
function getActiveTimers() {
  return timers.size;
}

/** Clear every running timer (called on shutdown). */
function clearAll() {
  for (const [, timeout] of timers) {
    clearTimeout(timeout);
  }
  timers.clear();
  logger.info('All inactivity timers cleared');
}

module.exports = { setProcessor, resetTimer, clearAll, getActiveTimers };
