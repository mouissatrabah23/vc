/**
 * Typed fetch wrapper for the Express API — SCAFFOLD.
 *
 * The response envelope comes from @saas/types, so a change to the API's error
 * shape is a compile error here rather than a runtime surprise.
 */

import type { ApiResponse } from '@saas/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
    // Auth is not wired up yet; when it is, this carries the Supabase session.
    credentials: 'include',
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.ok) {
    throw new ApiRequestError(
      response.status,
      payload.error.code,
      payload.error.message,
      payload.error.requestId,
    );
  }

  return payload.data;
}
