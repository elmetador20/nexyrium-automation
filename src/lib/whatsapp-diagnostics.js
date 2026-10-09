const { describeError } = require('./logger');

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

module.exports = { safeErrorDetails, safeEventValue };
