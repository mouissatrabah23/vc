/**
 * Per-job scratch directory management.
 *
 * Each job gets an isolated directory under JOB_WORKDIR, removed when the job
 * settles. Isolation keeps concurrent jobs from colliding on output filenames
 * and makes cleanup a single `rm -rf` of a known path.
 */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.js';
import { logger } from './logger.js';

/** Rejects anything that would escape JOB_WORKDIR via `..` or an absolute path. */
export function resolveWithinWorkdir(...segments: string[]): string {
  const base = path.resolve(env.JOB_WORKDIR);
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Refusing to operate outside JOB_WORKDIR: ${target}`);
  }
  return target;
}

export async function createJobWorkdir(jobId: string): Promise<string> {
  const dir = resolveWithinWorkdir(jobId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Best-effort cleanup: a failure here must never mask the job's own error. */
export async function removeJobWorkdir(dir: string): Promise<void> {
  try {
    resolveWithinWorkdir(path.relative(path.resolve(env.JOB_WORKDIR), dir));
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn({ err: error, dir }, 'failed to clean job workdir');
  }
}
