/** Process entrypoint: bind the port and shut down cleanly. */

import { disconnectDatabase } from '@saas/db';
import { createApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { closeQueues } from './queue.js';
import { redis } from './redis.js';

const app = createApp();

const server = app.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, env: env.NODE_ENV },
    `api listening on http://localhost:${env.API_PORT}`,
  );
});

/**
 * Graceful shutdown: stop accepting connections, drain in-flight requests,
 * then release Redis and Postgres. Without this, a rolling deploy can drop
 * requests and leak connections.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeQueues();
    redis.disconnect();
    await disconnectDatabase();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  void shutdown('uncaughtException');
});
