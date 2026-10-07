require('dotenv').config({ quiet: true });
const app = require('./src/app');
const logger = require('./src/lib/logger');

let exiting = false;
function logFailure(message, error) {
  logger.error(message, { error: logger.describeError(error) });
}

function exit(code, error) {
  if (exiting) return;
  exiting = true;
  if (error) logFailure(code === 0 ? 'Shutdown requested with an error' : 'Process failure', error);
  // Render can forcibly terminate the process; remote backups are periodic,
  // never dependent on this shutdown hook finishing.
  const deadline = setTimeout(() => process.exit(code), 20_000);
  deadline.unref();
  // Wrap shutdown in a promise: app.shutdown() can itself fail while loading
  // configuration/dependencies, and that failure must not hide the original.
  Promise.resolve()
    .then(() => app.shutdown())
    .catch((shutdownError) => logFailure('Application shutdown failed', shutdownError))
    .finally(() => process.exit(code));
}

process.on('SIGINT', () => exit(0));
process.on('SIGTERM', () => exit(0));
process.on('unhandledRejection', (reason) => {
  logFailure('Unhandled asynchronous failure; shutting down safely', reason);
  exit(1);
});
process.on('uncaughtException', (error) => {
  logFailure('Unhandled process failure; shutting down safely', error);
  exit(1);
});
Promise.resolve().then(() => app.bootstrap()).catch((error) => {
  logFailure('Application startup failed', error);
  exit(1);
});
