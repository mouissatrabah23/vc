/** Express application wiring. Kept separate from index.ts so tests can import
 *  the app without binding a port. */

import express from 'express';
import type { Express, Request } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './env.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler, requestId } from './http/middleware.js';
import { healthRouter } from './routes/health.js';
import { v1Router } from './routes/index.js';

/** Request augmented with the raw body captured for webhook HMAC checks. */
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function createApp(): Express {
  const app = express();

  // Behind a load balancer (Fly, Railway, Nginx) so req.ip and req.protocol
  // come from X-Forwarded-*. Scoped to one hop — trusting all proxies would
  // let a client spoof its own IP for rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: [env.WEB_URL],
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );
  app.use(compression());
  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => res.locals.requestId as string,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );

  app.use(
    express.json({
      limit: '1mb',
      // Keep the raw bytes so webhook signature verification can hash exactly
      // what was received. Re-serialising JSON changes key order and spacing.
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(healthRouter);
  app.use('/api/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
