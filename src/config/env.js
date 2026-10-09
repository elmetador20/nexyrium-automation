/**
 * Environment configuration — validates and loads all required env vars.
 *
 * @module config/env
 */

const path = require('node:path');

const REQUIRED_VARS = [
  'NODE_ENV',
  'DATABASE_URL',
  'OPENROUTER_API_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'GOOGLE_SHEETS_CREDENTIALS_PATH',
  'WHATSAPP_SESSION_DATA_PATH',
  'WHATSAPP_MONGODB_URI',
];

const defaults = {
  NODE_ENV: 'development',
  PORT: 10000,
  WHATSAPP_SESSION_DATA_PATH: './.wwebjs_auth',
  GOOGLE_SHEETS_CREDENTIALS_PATH: './credentials.json',
  CRON_SCHEDULE: '*/5 * * * *',
  MAX_RETRIES: 5,
  RETRY_DELAY_MS: 5000,
};

function resolveWhatsAppSessionDataPath() {
  const configured = process.env.WHATSAPP_SESSION_DATA_PATH;
  // /app/.wwebjs_auth was the old Docker image path. A manually configured
  // Render Node service runs from /opt/render/project/src, where /app is not
  // writable. Preserve custom paths, but make this legacy value safe.
  if (configured === '/app/.wwebjs_auth' && path.resolve('.') !== '/app') {
    // eslint-disable-next-line no-console
    console.warn('[STARTUP] Ignoring legacy Docker WhatsApp session path; using ./.wwebjs_auth');
    return defaults.WHATSAPP_SESSION_DATA_PATH;
  }
  return configured || defaults.WHATSAPP_SESSION_DATA_PATH;
}

function loadEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key] && !defaults[key]);
  if (process.env.NODE_ENV === 'production') {
    // These may have development fallbacks, but production must name the
    // Render Secret File explicitly so a typo cannot silently become a local
    // relative path inside the container.
    for (const key of ['GOOGLE_SHEETS_CREDENTIALS_PATH', 'ADMIN_API_TOKEN']) {
      if (!process.env[key] && !missing.includes(key)) missing.push(key);
    }
  }

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[STARTUP] Missing required environment variables: ${missing.join(', ')}`);
    throw new Error('Required environment variables are missing');
  }

  const clientId = process.env.WHATSAPP_CLIENT_ID || 'nexyrium';
  if (!/^[-_\w]+$/.test(clientId)) throw new Error('WHATSAPP_CLIENT_ID must use letters, digits, underscores, or hyphens');
  const backupInterval = Number(process.env.WHATSAPP_BACKUP_INTERVAL_MS || 300_000);
  if (!Number.isInteger(backupInterval) || backupInterval < 60_000) throw new Error('WHATSAPP_BACKUP_INTERVAL_MS must be at least 60000');
  if (process.env.ADMIN_API_TOKEN && process.env.ADMIN_API_TOKEN.length < 32) throw new Error('ADMIN_API_TOKEN must contain at least 32 characters');

  return {
    NODE_ENV: process.env.NODE_ENV || defaults.NODE_ENV,
    PORT: parseInt(process.env.PORT, 10) || defaults.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo',
    GOOGLE_SHEETS_SPREADSHEET_ID: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    GOOGLE_SHEETS_CREDENTIALS_PATH: process.env.GOOGLE_SHEETS_CREDENTIALS_PATH || defaults.GOOGLE_SHEETS_CREDENTIALS_PATH,
    WHATSAPP_SESSION_DATA_PATH: resolveWhatsAppSessionDataPath(),
    WHATSAPP_MONGODB_URI: process.env.WHATSAPP_MONGODB_URI,
    WHATSAPP_CLIENT_ID: clientId,
    WHATSAPP_BACKUP_INTERVAL_MS: backupInterval,
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    CRON_SCHEDULE: process.env.CRON_SCHEDULE || defaults.CRON_SCHEDULE,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES, 10) || defaults.MAX_RETRIES,
    RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS, 10) || defaults.RETRY_DELAY_MS,
  };
}

const env = loadEnv();

module.exports = { env };
