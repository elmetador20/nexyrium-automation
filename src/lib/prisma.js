const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { parseDatabaseUrl } = require('../config/database');
const logger = require('./logger');

// Prisma 7 requires a driver adapter. This is one module-level client shared by
// repositories, the database monitor, and the WhatsApp dependency graph.
// MariaDB's pool replaces dropped connections on subsequent requests. Do not
// retry writes blindly: a response can be lost after a write was committed.
const databaseOptions = parseDatabaseUrl(process.env.DATABASE_URL);
logger.info('Database configuration loaded', {
  databaseHost: databaseOptions.host,
  databasePort: databaseOptions.port,
  databaseName: databaseOptions.database,
  databaseSsl: databaseOptions.ssl ? 'configured' : 'not configured',
  httpPort: process.env.PORT || 'unset',
});
const adapter = new PrismaMariaDb(databaseOptions);
const prisma = new PrismaClient({ adapter, log: [] });

module.exports = { prisma };
