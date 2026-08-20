/**
 * Loads and validates the worker's environment at boot.
 *
 * In Docker the values come from real environment variables (there is no .env
 * in the image); locally they come from the repo-root .env. `override: false`
 * makes real env vars win in both cases.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../..');

loadDotenv({ path: path.join(repoRoot, '.env'), override: false });
loadDotenv({ path: path.join(packageRoot, '.env'), override: false });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  QUEUE_PREFIX: z.string().default('saas:dev'),

  /** Keep at or below the container's CPU allocation — krillinai runs are heavy. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),

  /** Must match the install path in the Dockerfile. */
  KRILLINAI_CLI_PATH: z.string().default('/usr/local/bin/krillinai-cli'),

  /**
   * config.toml rendered by docker/entrypoint.sh at container startup. Holds
   * the provider API keys, so the worker passes the PATH to the CLI and never
   * reads the file itself.
   */
  KRILLINAI_CONFIG_PATH: z.string().default('/app/config/config.toml'),

  /** Scratch space. Must be writable by the non-root user in the container. */
  JOB_WORKDIR: z.string().default('/app/work'),

  /** Hard kill for a single CLI invocation, so a hung run cannot pin a slot. */
  KRILLINAI_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),

  /**
   * Provider credentials for krillinai-cli.
   *
   * These are consumed by docker/entrypoint.sh, which substitutes them into
   * config.toml before this process starts — the Node worker never sends them
   * anywhere itself. They are declared here only so that a missing key is
   * reported once at boot, rather than as an opaque CLI failure on the first
   * job. Optional, because the worker must still start and serve health checks
   * without them.
   */
  KRILLINAI_LLM_API_KEY: z.string().optional(),
  KRILLINAI_TTS_PROVIDER_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`\nInvalid environment for @saas/worker:\n${issues}\n`);
  console.error('Did you run `cp .env.example .env` at the repo root?\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
