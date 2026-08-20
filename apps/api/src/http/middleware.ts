/** Cross-cutting middleware: request id, async wrapper, 404, error handler. */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../env.js';
import { logger } from '../logger.js';
import { AppError, sendFailure } from './errors.js';

/**
 * Assigns a request id (honouring an upstream `x-request-id`) and echoes it on
 * the response. It is threaded into job payloads so a browser action can be
 * traced through the API into a worker log line.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 4 does not do this itself — without it, a rejection hangs the request.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendFailure(res, 'not_found', `No route for ${req.method} ${req.path}`);
};

/** Terminal error handler. Must keep all four parameters to be recognised. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_';
      (details[key] ??= []).push(issue.message);
    }
    sendFailure(res, 'validation_failed', 'Request validation failed', details);
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ err: error, code: error.code }, 'request failed');
    }
    sendFailure(
      res,
      error.code,
      error.expose ? error.message : 'Internal server error',
      error.details,
    );
    return;
  }

  logger.error({ err: error }, 'unhandled error');
  sendFailure(res, 'internal_error', isProduction ? 'Internal server error' : String(error));
}
