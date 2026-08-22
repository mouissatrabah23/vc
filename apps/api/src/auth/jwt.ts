/**
 * Supabase access-token verification.
 *
 * Supabase signs its access tokens with a project-wide HMAC secret, so the API
 * can verify them locally. That matters: doing a round-trip to the Auth server
 * on every request would put an external dependency in the hot path of every
 * authenticated call.
 */

import { jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../env.js';

/** Claims we rely on. Supabase includes many more; these are the contract. */
export interface SupabaseClaims {
  /** The user id. Also the PK of public.users and the value auth.uid() returns. */
  sub: string;
  email?: string;
  phone?: string;
  /** `authenticated` for a signed-in user, `anon` for the public key. */
  role?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  session_id?: string;
  /** Provider info set by Supabase, e.g. { provider: 'google' }. */
  app_metadata?: Record<string, unknown>;
  /** Arbitrary sign-up metadata, e.g. { full_name: '...' }. */
  user_metadata?: Record<string, unknown>;
}

export type JwtFailureReason = 'expired' | 'malformed' | 'signature' | 'claims';

export class JwtVerificationError extends Error {
  constructor(
    readonly reason: JwtFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'JwtVerificationError';
  }
}

// Encoded once. Re-encoding per request is wasted work on a hot path.
const secretKey = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);

/**
 * Verifies signature, expiry and audience, and returns the claims.
 *
 * Deliberately does NOT check `iss`: tokens minted by a local GoTrue carry no
 * issuer claim, and requiring one would make every local token fail while
 * passing in production — the worst kind of environment-specific difference.
 * Signature and audience already establish that we minted it.
 */
export async function verifySupabaseToken(token: string): Promise<SupabaseClaims> {
  let payload: SupabaseClaims;

  try {
    const result = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
      audience: 'authenticated',
      // Supabase tokens are short-lived; no clock tolerance beyond a small
      // allowance for skew between this host and the auth server.
      clockTolerance: 5,
    });
    payload = result.payload as unknown as SupabaseClaims;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw new JwtVerificationError('expired', 'Access token has expired');
    }
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      throw new JwtVerificationError('claims', `Invalid token claims: ${error.claim}`);
    }
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new JwtVerificationError('signature', 'Token signature does not verify');
    }
    throw new JwtVerificationError('malformed', 'Token could not be parsed');
  }

  // `sub` is what everything downstream keys on — RLS, ownership, the wallet
  // lookup. A token without it is unusable even though it verified.
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new JwtVerificationError('claims', 'Token has no subject claim');
  }

  // An `anon` token is a valid signature over a non-user. Treating it as a
  // login would authenticate every visitor as the same phantom account.
  if (payload.role && payload.role !== 'authenticated') {
    throw new JwtVerificationError('claims', `Unexpected role claim: ${payload.role}`);
  }

  return payload;
}

/** Extracts a bearer token, or null when the header is absent/malformed. */
export function bearerFrom(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const [scheme, ...rest] = headerValue.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}
