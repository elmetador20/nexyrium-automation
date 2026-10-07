const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { parseDatabaseUrl } = require('../config/database');

// MariaDB's pool replaces dropped connections on subsequent requests. Do not
// retry writes blindly: a response can be lost after a write was committed.
const adapter = new PrismaMariaDb(parseDatabaseUrl(process.env.DATABASE_URL));
const prisma = new PrismaClient({ adapter, log: [] });

module.exports = { prisma };
