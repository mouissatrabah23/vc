/**
 * Authentication middleware.
 *
 * `requireAuth` rejects anything without a valid Supabase access token.
 * `optionalAuth` attaches the user when present but never rejects — for routes
 * that render differently for signed-in visitors.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../http/errors.js';
import { logger } from '../logger.js';
import { bearerFrom, JwtVerificationError, verifySupabaseToken } from './jwt.js';
import type { SupabaseClaims } from './jwt.js';

/** The authenticated principal, attached to the request by these middlewares. */
export interface AuthContext {
  userId: string;
  email?: string;
  /** Sign-in provider reported by Supabase, e.g. `email`, `google`. */
  provider?: string;
  claims: SupabaseClaims;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present only after requireAuth; optional after optionalAuth. */
      auth?: AuthContext;
    }
  }
}

function toContext(claims: SupabaseClaims): AuthContext {
  const provider =
    typeof claims.app_metadata?.provider === 'string' ? claims.app_metadata.provider : undefined;
  return { userId: claims.sub, email: claims.email, provider, claims };
}

/**
 * Maps a verification failure to a client-facing message.
 *
 * `expired` is called out separately on purpose: it is the one failure a
 * correct client should act on, by refreshing the session rather than sending
 * the user back to the login screen.
 */
function toAppError(error: JwtVerificationError): AppError {
  if (error.reason === 'expired') {
    return new AppError('unauthorized', 'Access token has expired');
  }
  return new AppError('unauthorized', 'Invalid access token');
}

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const token = bearerFrom(req.header('authorization'));

  if (!token) {
    next(AppError.unauthorized('Missing bearer token'));
    return;
  }

  verifySupabaseToken(token)
    .then((claims) => {
      req.auth = toContext(claims);
      // The user id joins API logs to worker logs and to database rows for one
      // request. The token itself is never logged.
      res.locals.userId = claims.sub;
      next();
    })
    .catch((error: unknown) => {
      if (error instanceof JwtVerificationError) {
        logger.debug({ reason: error.reason }, 'token rejected');
        next(toAppError(error));
        return;
      }
      next(error);
    });
};

export const optionalAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const token = bearerFrom(req.header('authorization'));
  if (!token) {
    next();
    return;
  }

  verifySupabaseToken(token)
    .then((claims) => {
      req.auth = toContext(claims);
      res.locals.userId = claims.sub;
      next();
    })
    // A bad token on an optional route is treated as "not signed in" rather
    // than an error, so a stale token cannot break public pages.
    .catch(() => next());
};

/**
 * Narrowing helper for handlers mounted behind `requireAuth`.
 *
 * Express's types cannot express "this middleware ran", so `req.auth` stays
 * optional. This throws rather than returning undefined, turning a routing
 * mistake into a loud 500 instead of a silent unauthenticated read.
 */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.auth) {
    throw new AppError('internal_error', 'Route is missing requireAuth middleware');
  }
  return req.auth;
}
