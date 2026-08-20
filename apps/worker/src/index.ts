/** Worker entrypoint: start the queue consumers, shut them down cleanly. */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '@saas/types';
import { disconnectDatabase } from '@saas/db';
import { env } from './env.js';
import { logger } from './logger.js';
import { redis } from './redis.js';
import { assertKrillinaiAvailable } from './krillinai.js';
import { processMediaJob } from './processors/media.js';
import { processSystemJob } from './processors/system.js';

await assertKrillinaiAvailable();

const shared = {
  connection: redis,
  prefix: env.QUEUE_PREFIX,
  // A stalled job is one whose lock expired — usually a crashed worker. Two
  // reclaim attempts, then it is failed rather than looping forever.
  maxStalledCount: 2,
  stalledInterval: 30_000,
};

const mediaWorker = new Worker(QUEUE_NAMES.MEDIA, processMediaJob, {
  ...shared,
  concurrency: env.WORKER_CONCURRENCY,
  // krillinai runs are long; the lock must outlive a single processing step or
  // BullMQ will consider the job stalled while it is still running.
  lockDuration: 120_000,
});

const systemWorker = new Worker(QUEUE_NAMES.SYSTEM, processSystemJob, {
  ...shared,
  concurrency: Math.max(1, env.WORKER_CONCURRENCY * 2),
});

for (const worker of [mediaWorker, systemWorker]) {
  worker.on('completed', (job: Job) => {
    logger.info({ queueJobId: job.id, jobName: job.name }, 'job completed');
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error(
      { queueJobId: job?.id, jobName: job?.name, attempt: job?.attemptsMade, err: error },
      'job failed',
    );
  });

  worker.on('error', (error: Error) => {
    logger.error({ err: error }, 'worker error');
  });
}

logger.info(
  { concurrency: env.WORKER_CONCURRENCY, queues: Object.values(QUEUE_NAMES) },
  'worker ready',
);

/**
 * `worker.close()` waits for in-flight jobs to finish before resolving, so an
 * orchestrator's SIGTERM does not abandon a half-finished krillinai run. Give
 * it a grace window, then force exit.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'draining workers');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 30_000);
  forceExit.unref();

  try {
    await Promise.all([mediaWorker.close(), systemWorker.close()]);
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
