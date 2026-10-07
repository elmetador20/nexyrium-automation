require('dotenv').config({ quiet: true });
const app = require('./src/app');
const logger = require('./src/lib/logger');

let exiting = false;
function exit(code) {
  if (exiting) return;
  exiting = true;
  // Render can forcibly terminate the process; remote backups are periodic,
  // never dependent on this shutdown hook finishing.
  const deadline = setTimeout(() => process.exit(code), 20_000);
  deadline.unref();
  app.shutdown().finally(() => process.exit(code));
}

process.on('SIGINT', () => exit(0));
process.on('SIGTERM', () => exit(0));
process.on('unhandledRejection', () => {
  logger.error('Unhandled asynchronous failure; shutting down safely');
  exit(1);
});
process.on('uncaughtException', () => {
  logger.error('Unhandled process failure; shutting down safely');
  exit(1);
});
Promise.resolve().then(() => app.bootstrap()).catch(() => {
  logger.error('Application startup failed');
  exit(1);
});
