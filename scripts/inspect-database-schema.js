/** Read-only schema/migration audit. Never reads lead rows or migration logs. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const mariadb = require('mariadb');
const { Prisma } = require('@prisma/client');
const { parseDatabaseUrl } = require('../src/config/database');

require('dotenv').config({ quiet: true });

async function inspect() {
  let connection;
  try {
    const options = parseDatabaseUrl(process.env.DATABASE_URL);
    console.log(JSON.stringify({
      databaseHost: options.host, databasePort: options.port,
      databaseName: options.database, sslConfigured: !!options.ssl,
    }));
    // One direct connection gives useful connection error codes without a pool
    // timeout. Use exactly the application's existing URL/TLS options.
    connection = await mariadb.createConnection(options);
    const models = Prisma.dmmf.datamodel.models;
    const tables = models.map((model) => model.dbName || model.name);
    const placeholders = tables.map(() => '?').join(', ');
    const columns = await connection.query(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME, ORDINAL_POSITION`, tables);
    const indexes = await connection.query(`
      SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, tables);
    const foreignKeys = await connection.query(`
      SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
             k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME IN (${placeholders})
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, tables);
    const missingColumns = models.flatMap((model) => model.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => ({ table: model.dbName || model.name, column: field.dbName || field.name }))
      .filter(({ table, column }) => !columns.some((row) => row.TABLE_NAME === table && row.COLUMN_NAME === column)));

    const ledger = await connection.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '_prisma_migrations'`);
    const applied = ledger.length ? await connection.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM _prisma_migrations ORDER BY started_at`) : [];
    const directory = path.resolve(__dirname, '../prisma/migrations');
    const migrationNames = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const migrations = migrationNames.map((name) => {
      const checksum = createHash('sha256')
        .update(fs.readFileSync(path.join(directory, name, 'migration.sql'))).digest('hex');
      const records = applied.filter((row) => row.migration_name === name);
      return {
        name,
        applied: records.some((row) => row.finished_at && !row.rolled_back_at),
        failedOrUnfinished: records.some((row) => !row.finished_at && !row.rolled_back_at),
        checksumMismatch: records.some((row) => !row.rolled_back_at && row.checksum !== checksum),
      };
    });
    const unknownMigrations = applied
      .filter((row) => !migrationNames.includes(row.migration_name))
      .map((row) => ({
        name: row.migration_name,
        applied: !!row.finished_at && !row.rolled_back_at,
        failedOrUnfinished: !row.finished_at && !row.rolled_back_at,
      }));
    console.log(JSON.stringify({
      columns, indexes, foreignKeys, missingColumns,
      migrationLedgerExists: ledger.length > 0, migrations, unknownMigrations,
    }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
    // This audit lists physical types/defaults/indexes for review, but only
    // automatically checks column presence and migration ledger consistency.
    // Use Prisma migrate diff for the complete schema comparison.
    if (missingColumns.length || !ledger.length || unknownMigrations.length
      || migrations.some((row) => !row.applied || row.failedOrUnfinished || row.checksumMismatch)) {
      process.exitCode = 2;
    }
  } catch (error) {
    // Do not print connection strings, driver options, SQL errors, or their
    // arbitrary messages/stacks. Codes suffice for connection troubleshooting.
    console.error(JSON.stringify({ schemaInspectionFailed: true, name: error.name, code: error.code, errno: error.errno }));
    process.exitCode = 1;
  } finally {
    await connection?.end();
  }
}

inspect().catch(() => {
  console.error('Schema inspection could not close its database connection');
  process.exitCode = 1;
});
