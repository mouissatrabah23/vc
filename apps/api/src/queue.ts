/**
 * BullMQ producers.
 *
 * The API only ever *enqueues*. Processing lives in apps/worker so a slow
 * krillinai-cli run can never occupy an HTTP request thread.
 */

import { Queue } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from '@saas/types';
import type { MediaJob, SystemJob } from '@saas/types';
import { env } from './env.js';
import { logger } from './logger.js';
import { redis } from './redis.js';

const connection = { connection: redis, prefix: env.QUEUE_PREFIX };

export const mediaQueue = new Queue(QUEUE_NAMES.MEDIA, connection);
export const systemQueue = new Queue(QUEUE_NAMES.SYSTEM, connection);

/**
 * Type-safe enqueue: `name` and `data` must belong to the same MediaJob
 * variant, so a payload can never be sent under the wrong job name.
 */
export async function enqueueMediaJob<T extends MediaJob>(job: T): Promise<string> {
  const queued = await mediaQueue.add(job.name, job.data, { ...DEFAULT_JOB_OPTIONS });
  logger.info({ jobName: job.name, queueJobId: queued.id }, 'media job enqueued');
  return queued.id ?? '';
}

export async function enqueueSystemJob<T extends SystemJob>(job: T): Promise<string> {
  const queued = await systemQueue.add(job.name, job.data, { ...DEFAULT_JOB_OPTIONS });
  logger.info({ jobName: job.name, queueJobId: queued.id }, 'system job enqueued');
  return queued.id ?? '';
}

export async function closeQueues(): Promise<void> {
  await Promise.all([mediaQueue.close(), systemQueue.close()]);
}
