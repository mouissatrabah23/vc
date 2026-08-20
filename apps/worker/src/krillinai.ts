/**
 * krillinai-cli process boundary — SCAFFOLD ONLY.
 *
 * Every invocation of the CLI goes through `runKrillinai`. Keeping it behind a
 * single function means the safety rules (no shell, hard timeout, bounded
 * output buffer, per-job working directory) are enforced in one place instead
 * of at each call site.
 *
 * The argument construction and output parsing are intentionally left for the
 * implementation stage; this file establishes the contract and the guardrails.
 */

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { env } from './env.js';
import { logger } from './logger.js';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class KrillinaiError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'KrillinaiError';
  }
}

/** Cap captured output so a chatty run cannot exhaust the worker's heap. */
const MAX_OUTPUT_BYTES = 1_000_000;

/** Verified once at startup so a misconfigured image fails fast, not per job. */
export async function assertKrillinaiAvailable(): Promise<void> {
  try {
    await access(env.KRILLINAI_CLI_PATH, constants.X_OK);
    logger.info({ path: env.KRILLINAI_CLI_PATH }, 'krillinai-cli found');
  } catch {
    logger.warn(
      { path: env.KRILLINAI_CLI_PATH },
      'krillinai-cli not found or not executable — media jobs will fail. ' +
        'This is expected outside the worker container.',
    );
  }

  // Rendered by docker/entrypoint.sh from config.toml.template. Its absence
  // means the entrypoint was bypassed (e.g. `docker run --entrypoint node`),
  // which the CLI would otherwise report as an unrelated provider error.
  try {
    await access(env.KRILLINAI_CONFIG_PATH, constants.R_OK);
    logger.info({ path: env.KRILLINAI_CONFIG_PATH }, 'krillinai config found');
  } catch {
    logger.warn(
      { path: env.KRILLINAI_CONFIG_PATH },
      'krillinai config.toml not readable — the container entrypoint may have ' +
        'been bypassed. Expected outside the worker container.',
    );
  }

  if (!env.KRILLINAI_LLM_API_KEY) {
    logger.warn('KRILLINAI_LLM_API_KEY is not set — translation jobs will fail');
  }
  if (!env.KRILLINAI_TTS_PROVIDER_KEY) {
    logger.warn('KRILLINAI_TTS_PROVIDER_KEY is not set — dubbing jobs will fail');
  }
}

/**
 * Runs krillinai-cli with the given arguments.
 *
 * Deliberately uses `spawn` without a shell: arguments carry user-controlled
 * values (file names, language codes), and `shell: true` would make them
 * injectable.
 *
 * UNVERIFIED — confirm before implementing processors: how the pinned CLI
 * locates its config. Upstream's own image runs the binary with WORKDIR /app
 * and the file at /app/config/config.toml, i.e. discovery looks CWD-relative,
 * whereas we spawn with `cwd` set to the isolated job directory. Run
 * `docker run --rm --entrypoint krillinai-cli saas-worker:local --help`
 * against the built image and, if a `--config` flag exists, prepend it here;
 * otherwise pass `cwd: '/app'` and use absolute paths for the media arguments.
 */
export async function runKrillinai(
  args: string[],
  options: { cwd: string; signal?: AbortSignal } = { cwd: env.JOB_WORKDIR },
): Promise<RunResult> {
  const startedAt = Date.now();

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(env.KRILLINAI_CLI_PATH, args, {
      cwd: options.cwd,
      // Explicit allow-list: the CLI inherits only what it needs, never the
      // worker's database credentials or R2 secrets. Provider API keys are NOT
      // passed here — they live in the config.toml that entrypoint.sh rendered,
      // which keeps them out of this process's argv and child environment.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? options.cwd,
        TMPDIR: options.cwd,
        KRILLINAI_CONFIG_PATH: env.KRILLINAI_CONFIG_PATH,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      signal: options.signal,
      timeout: env.KRILLINAI_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(new KrillinaiError(`Failed to spawn krillinai-cli: ${error.message}`, null, stderr));
    });

    child.on('close', (exitCode) => {
      const durationMs = Date.now() - startedAt;
      if (exitCode === 0) {
        resolve({ exitCode, stdout, stderr, durationMs });
        return;
      }
      reject(
        new KrillinaiError(
          `krillinai-cli exited with code ${exitCode ?? 'null'}`,
          exitCode,
          stderr.slice(-4000),
        ),
      );
    });
  });
}
