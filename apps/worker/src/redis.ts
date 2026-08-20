/**
 * ioredis connection for the BullMQ worker.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ: workers hold blocking
 * commands open while waiting for jobs, and ioredis' default retry budget
 * would abort them.
 */

import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (error: Error) => {
  logger.error({ err: error }, 'redis connection error');
});

redis.on('ready', () => {
  logger.info('redis connected');
});
