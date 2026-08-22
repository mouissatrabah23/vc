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

import { PrismaClient, type Prisma } from '@prisma/client';

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

/**
 * Runs `fn` as the `authenticated` Postgres role, with the given user id
 * presented as the JWT subject — so every Row Level Security policy applies
 * exactly as it would to that user querying through PostgREST.
 *
 * WHY THIS EXISTS
 * ---------------
 * The default `prisma` client connects as the owner role, which bypasses RLS.
 * That is correct for backend writes (pricing, crediting, job bookkeeping) but
 * it means a naive `prisma.task.findMany({ where: { userId } })` enforces
 * ownership only in application code. Forget the `where` clause once and you
 * leak another tenant's rows.
 *
 * Inside this helper the database refuses to return rows the user cannot see,
 * regardless of what the query asks for. Application-level filtering becomes a
 * performance detail rather than the security boundary.
 *
 * Both settings are transaction-local: `SET LOCAL ROLE` and `set_config(...,
 * true)` are reverted on COMMIT or ROLLBACK, so a pooled connection can never
 * be handed to the next request still impersonating someone.
 *
 * Use `prisma` directly for privileged work; use this for anything returning
 * user-owned data.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Not parameterisable: SET ROLE takes an identifier, not a value. The
    // literal is hard-coded rather than interpolated, so nothing user-supplied
    // reaches this statement.
    await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');

    // auth.uid() reads this GUC. Parameterised, so the user id is a value and
    // cannot break out of the string.
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${claims}, true)`;

    return fn(tx);
  });
}

/** Call from the process SIGTERM handler so in-flight queries drain cleanly. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
