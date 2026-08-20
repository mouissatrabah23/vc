/** Structured logging for the worker. JSON in production, pretty in dev. */

import { pino } from 'pino';
import { env, isProduction } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  redact: {
    paths: ['*.password', '*.token', '*.secret', '*.apiKey'],
    censor: '[redacted]',
  },
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
});

export type Logger = typeof logger;
