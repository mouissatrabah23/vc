/**
 * HTTP envelope shared by apps/api (producer) and apps/web (consumer).
 *
 * Every JSON response the API emits is either `ApiSuccess` or `ApiFailure`, so
 * the web client can discriminate on `ok` without inspecting status codes.
 */

import type { Cursor } from './common.js';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ApiFailure {
  ok: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Field-level validation detail, keyed by dotted path. */
  details?: Record<string, string[]>;
  /** Echoed request id — quote this in bug reports. */
  requestId?: string;
}

export interface ResponseMeta {
  requestId: string;
  nextCursor?: Cursor | null;
  total?: number;
}

export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'validation_failed',
  'rate_limited',
  'quota_exceeded',
  'payment_required',
  'not_implemented',
  'internal_error',
  'service_unavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Canonical HTTP status for each error code. Used by the error middleware. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  quota_exceeded: 429,
  payment_required: 402,
  not_implemented: 501,
  internal_error: 500,
  service_unavailable: 503,
};

export interface PaginationQuery {
  cursor?: Cursor;
  /** Clamped server-side to [1, 100]. */
  limit?: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptimeSeconds: number;
  checks: Record<string, DependencyCheck>;
}

export interface DependencyCheck {
  status: 'ok' | 'down';
  latencyMs?: number;
  error?: string;
}
