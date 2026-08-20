/**
 * Liveness and readiness.
 *
 *   GET /healthz  — process is up. No dependency checks: an orchestrator must
 *                   not restart the container because Redis blipped.
 *   GET /readyz   — safe to receive traffic. Checks Postgres and Redis, and
 *                   returns 503 when either is down.
 */

import { Router } from 'express';
import { checkDatabase } from '@saas/db';
import type { DependencyCheck, HealthReport } from '@saas/types';
import { checkRedis } from '../redis.js';
import { asyncHandler } from '../http/middleware.js';
import { sendSuccess } from '../http/errors.js';

const VERSION = process.env.npm_package_version ?? '0.0.0';

export const healthRouter: Router = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, data: { status: 'ok', uptimeSeconds: process.uptime() } });
});

healthRouter.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);

    const toCheck = (result: {
      ok: boolean;
      latencyMs: number;
      error?: string;
    }): DependencyCheck =>
      result.ok
        ? { status: 'ok', latencyMs: result.latencyMs }
        : { status: 'down', latencyMs: result.latencyMs, error: result.error };

    const healthy = database.ok && redis.ok;
    const report: HealthReport = {
      status: healthy ? 'ok' : 'degraded',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database: toCheck(database), redis: toCheck(redis) },
    };

    sendSuccess(res, report, healthy ? 200 : 503);
  }),
);
