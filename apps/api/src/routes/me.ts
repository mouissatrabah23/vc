/**
 * Authenticated identity routes.
 *
 * Every read here goes through `withUserContext`, which runs the query as the
 * `authenticated` Postgres role with the caller's id as `auth.uid()`. The Row
 * Level Security policies from Phase 1 are therefore the thing enforcing
 * ownership — not the `where` clauses. Drop a filter and the database still
 * returns nothing that belongs to someone else.
 */

import { Router } from 'express';
import { withUserContext } from '@saas/db';
import { asyncHandler } from '../http/middleware.js';
import { sendSuccess, AppError } from '../http/errors.js';
import { requireAuth, requireAuthContext } from '../auth/middleware.js';

export const meRouter: Router = Router();

meRouter.use(requireAuth);

/**
 * GET /api/v1/me
 *
 * Profile plus wallet balance. Note there is no `where: { userId }` on the
 * wallet lookup — `findFirst` returns the caller's wallet because RLS makes it
 * the only visible row. That is the end-to-end proof that the policy is live.
 */
meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, email, provider } = requireAuthContext(req);

    const result = await withUserContext(userId, async (tx) => {
      const profile = await tx.user.findFirst({
        select: { id: true, email: true, fullName: true, createdAt: true },
      });
      const wallet = await tx.creditWallet.findFirst({
        select: { id: true, balanceCredits: true, updatedAt: true },
      });
      return { profile, wallet };
    });

    // A verified token whose user row is absent means the provisioning trigger
    // did not run — a broken account rather than an authorisation failure, and
    // worth surfacing distinctly instead of returning an empty profile.
    if (!result.profile) {
      throw new AppError(
        'not_found',
        'Authenticated user has no profile row; signup provisioning may have failed',
      );
    }

    sendSuccess(res, {
      user: {
        id: result.profile.id,
        email: result.profile.email,
        fullName: result.profile.fullName,
        createdAt: result.profile.createdAt.toISOString(),
        provider,
      },
      wallet: result.wallet
        ? {
            id: result.wallet.id,
            // Decimal -> string: a numeric(10,2) does not fit a JS number
            // safely, and rounding a balance in transit is how money goes
            // missing.
            balanceCredits: result.wallet.balanceCredits.toString(),
            updatedAt: result.wallet.updatedAt.toISOString(),
          }
        : null,
      tokenEmail: email,
    });
  }),
);

/**
 * GET /api/v1/me/rls-check
 *
 * Diagnostic: reports what the database itself thinks the caller can see.
 * Counts come back from inside the user's RLS context, so they are the
 * policies' own answer rather than an assertion made in application code.
 */
meRouter.get(
  '/rls-check',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuthContext(req);

    const visible = await withUserContext(userId, async (tx) => ({
      users: await tx.user.count(),
      wallets: await tx.creditWallet.count(),
      walletTransactions: await tx.walletTransaction.count(),
      tasks: await tx.task.count(),
      payments: await tx.payment.count(),
    }));

    sendSuccess(res, {
      userId,
      visibleRowCounts: visible,
      note: 'Counts are produced inside the caller RLS context; each should cover only their own rows.',
    });
  }),
);
