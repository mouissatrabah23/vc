/** Typed application error + response helpers for the ApiResponse envelope. */

import type { Response } from 'express';
import { API_ERROR_STATUS } from '@saas/types';
import type { ApiErrorCode, ResponseMeta } from '@saas/types';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;
  readonly expose: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: Record<string, string[]>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = API_ERROR_STATUS[code];
    this.details = options.details;
    // 5xx messages are internal; never leak them to the client verbatim.
    this.expose = this.status < 500;
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError('not_found', message);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('unauthorized', message);
  }

  static forbidden(message = 'Not allowed'): AppError {
    return new AppError('forbidden', message);
  }

  /** Placeholder for endpoints scaffolded but not yet implemented. */
  static notImplemented(what: string): AppError {
    return new AppError('not_implemented', `${what} is not implemented yet`);
  }
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  status = 200,
  meta?: Partial<ResponseMeta>,
): void {
  res.status(status).json({
    ok: true,
    data,
    meta: { requestId: res.locals.requestId as string, ...meta },
  });
}

export function sendFailure(
  res: Response,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, string[]>,
): void {
  res.status(API_ERROR_STATUS[code]).json({
    ok: false,
    error: { code, message, details, requestId: res.locals.requestId as string },
  });
}
