/**
 * Shared ioredis connection for BullMQ producers.
 *
 * `maxRetriesPerRequest: null` is mandatory: BullMQ issues blocking commands
 * (BRPOPLPUSH) that outlive ioredis' default retry budget, and ioredis will
 * otherwise abort them mid-flight.
 */

import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (error: Error) => {
  logger.error({ err: error }, 'redis connection error');
});

redis.on('ready', () => {
  logger.info('redis connected');
});

export async function checkRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
