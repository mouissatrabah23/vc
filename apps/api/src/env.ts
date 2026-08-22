/**
 * Loads the root `.env` and validates it once, at boot.
 *
 * Importing this module has side effects on purpose: an invalid environment
 * should crash the process immediately with a readable list of problems,
 * rather than surfacing as `undefined` deep inside a request handler.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// dist/env.js at runtime, src/env.ts under tsx — both are one level below the
// package root, so ../../.. resolves to the repo root either way.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../..');

// Repo root first, then a package-local override for one-off experiments.
// `override: false` means real environment variables always win — which is how
// production (Fly/Railway/Docker secrets) is expected to supply configuration.
loadDotenv({ path: path.join(repoRoot, '.env'), override: false });
loadDotenv({ path: path.join(packageRoot, '.env'), override: false });

/**
 * A money-shaped decimal with at most two fraction digits.
 *
 * Rejects `1.005`, `1e3` and `-1` at boot rather than letting them reach the
 * hundredths parser, where they would silently truncate or go negative. Anything
 * priced in credits lands in a numeric(10,2) column eventually.
 */
const decimalString = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'must be a positive decimal with at most 2 fraction digits');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  QUEUE_PREFIX: z.string().default('saas:dev'),

  // Required: every authenticated request is verified against this. A missing
  // or wrong value fails closed (all 401s), so it is better to refuse to boot.
  // 32 bytes is the practical floor for an HS256 secret.
  SUPABASE_JWT_SECRET: z.string().min(32, 'SUPABASE_JWT_SECRET must be at least 32 characters'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  CHARGILY_API_KEY: z.string().optional(),
  CHARGILY_SECRET_KEY: z.string().optional(),
  // R2 stays optional so the API still boots without object storage configured
  // — health, auth and /me all work without it. The upload routes fail loudly
  // with a 503 instead, via assertR2Configured(). See storage/r2.ts.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  /** Capped at one hour: a presigned URL is a bearer credential. */
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),

  // --- Upload limits -------------------------------------------------------
  /** Hard ceiling on a single upload. Bound into the presigned signature. */
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024),
  /** Longest media accepted, in seconds. Enforced after probing, not before. */
  UPLOAD_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(7200),

  // --- ffprobe -------------------------------------------------------------
  /**
   * Absolute path, or a bare name resolved on PATH. Inside WSL this is
   * /usr/bin/ffprobe after `sudo apt install -y ffmpeg`.
   */
  FFPROBE_PATH: z.string().default('ffprobe'),
  /** Wall-clock ceiling for one probe. Kills a probe that stalls on the network. */
  FFPROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // --- Pricing -------------------------------------------------------------
  // PROVISIONAL. These are the single place credit rates are defined; there are
  // no other pricing constants in the codebase. The real numbers are set once a
  // full-pipeline run has produced one measured provider invoice.
  //
  // Decimal strings, not numbers: these are multiplied into a numeric(10,2)
  // column and parsed as integer hundredths, never as floats.
  CREDITS_PER_MINUTE_FULL_PIPELINE: decimalString.default('1.00'),
  CREDITS_PER_MINUTE_SUBTITLES_ONLY: decimalString.default('0.25'),
  /** Floor for any task, so a 12-second clip is never priced at zero. */
  MIN_CREDITS_PER_TASK: decimalString.default('1.00'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console -- the logger needs env to exist first
  console.error(`\nInvalid environment for @saas/api:\n${issues}\n`);
  console.error('Did you run `cp .env.example .env` at the repo root?\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
