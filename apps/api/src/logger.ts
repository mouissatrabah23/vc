/** Structured logging. JSON in production, pretty-printed in development. */

import { pino } from 'pino';
import { env, isProduction } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-chargily-signature"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.secret',
    ],
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
