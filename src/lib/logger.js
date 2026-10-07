/**
 * Logger utility with color-coded console output and log-level filtering.
 *
 * @module lib/logger
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m',
};

const configuredLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info;

function redact(value, key = '') {
  if (/password|token|secret|cookie|credential|private.?key|(^|_)qr($|_)|mongo.*uri|database.*url/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    let safe = value.replace(/(?:mongodb(?:\+srv)?|mysql):\/\/[^\s"']+/gi, '[REDACTED CONNECTION STRING]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
    for (const name of ['WHATSAPP_MONGODB_URI', 'DATABASE_URL', 'ADMIN_API_TOKEN', 'OPENROUTER_API_KEY']) {
      if (process.env[name]) safe = safe.split(process.env[name]).join('[REDACTED]');
    }
    return safe;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

/**
 * @param {'error'|'warn'|'info'|'debug'} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 * @returns {string}
 */
function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const color = COLORS[level];
  const prefix = `${color}[${timestamp}] ${level.toUpperCase()}${COLORS.reset}`;

  if (meta && Object.keys(meta).length > 0) {
    return `${prefix} ${redact(message)} ${JSON.stringify(redact(meta))}`;
  }

  return `${prefix} ${redact(message)}`;
}

/** Structured logger with four severity levels. */
const logger = {
  /** @param {string} message @param {Record<string,unknown>} [meta] */
  error(message, meta = {}) {
    if (LOG_LEVELS.error <= configuredLevel) {
      console.error(formatMessage('error', message, meta));
    }
  },

  /** @param {string} message @param {Record<string,unknown>} [meta] */
  warn(message, meta = {}) {
    if (LOG_LEVELS.warn <= configuredLevel) {
      console.warn(formatMessage('warn', message, meta));
    }
  },

  /** @param {string} message @param {Record<string,unknown>} [meta] */
  info(message, meta = {}) {
    if (LOG_LEVELS.info <= configuredLevel) {
      console.log(formatMessage('info', message, meta));
    }
  },

  /** @param {string} message @param {Record<string,unknown>} [meta] */
  debug(message, meta = {}) {
    if (LOG_LEVELS.debug <= configuredLevel) {
      console.log(formatMessage('debug', message, meta));
    }
  },
};

module.exports = logger;
