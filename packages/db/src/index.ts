/**
 * @saas/db — the single PrismaClient for the whole monorepo.
 *
 * Why a singleton: every `new PrismaClient()` opens its own connection pool.
 * Next.js dev HMR and `tsx watch` re-evaluate modules on every change, so
 * without the globalThis cache below you exhaust Postgres connections within
 * a handful of saves. In production the module is evaluated once and the cache
 * is inert.
 *
 * Usage:
 *   import { prisma } from '@saas/db';
 *   const user = await prisma.user.findUnique({ where: { id } });
 */

import { PrismaClient } from '@prisma/client';

/** Re-exported so consumers never depend on `@prisma/client` directly. */
export * from '@prisma/client';

const isProduction = process.env.NODE_ENV === 'production';

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['query', 'warn', 'error'],
    errorFormat: isProduction ? 'minimal' : 'pretty',
  });
}

const globalForPrisma = globalThis as unknown as {
  __saasPrisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.__saasPrisma ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.__saasPrisma = prisma;
}

/**
 * Liveness probe for `/readyz`. Returns latency instead of throwing so the
 * health endpoint can report `degraded` rather than 500.
 */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Call from the process SIGTERM handler so in-flight queries drain cleanly. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
