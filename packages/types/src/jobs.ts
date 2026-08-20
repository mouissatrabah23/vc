/**
 * Job payload / progress / result contracts.
 *
 * The producer (apps/api) constructs these; the consumer (apps/worker) narrows
 * on `name` to pick a processor. Payloads must stay JSON-serialisable — they
 * round-trip through Redis.
 */

import type { ISODateString, UUID } from './common.js';
import type { MediaAsset, TranscodeOptions, Transcript } from './media.js';
import type { MEDIA_JOB_NAMES, SYSTEM_JOB_NAMES } from './queues.js';

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Fields present on every job payload, whatever the queue. */
export interface JobEnvelope {
  /** Our own row id — the BullMQ job id is an implementation detail. */
  jobId: UUID;
  userId: UUID;
  projectId: UUID;
  /** Propagated to the worker's logger so one request is traceable end to end. */
  requestId?: string;
  enqueuedAt: ISODateString;
}

// -----------------------------------------------------------------------------
// Media queue
// -----------------------------------------------------------------------------

export interface TranscribeJobPayload extends JobEnvelope {
  /** R2 object key of the source upload. Never a browser-facing URL. */
  sourceKey: string;
  options: TranscodeOptions;
}

export interface TranslateJobPayload extends JobEnvelope {
  transcript: Transcript;
  options: TranscodeOptions;
}

export interface RenderSubtitlesJobPayload extends JobEnvelope {
  sourceKey: string;
  transcript: Transcript;
  options: TranscodeOptions;
}

/** Discriminated union of everything the media worker may receive. */
export type MediaJob =
  | { name: typeof MEDIA_JOB_NAMES.TRANSCRIBE; data: TranscribeJobPayload }
  | { name: typeof MEDIA_JOB_NAMES.TRANSLATE; data: TranslateJobPayload }
  | { name: typeof MEDIA_JOB_NAMES.RENDER_SUBTITLES; data: RenderSubtitlesJobPayload };

export type MediaJobPayload = MediaJob['data'];

// -----------------------------------------------------------------------------
// System queue
// -----------------------------------------------------------------------------

export interface CleanupWorkdirPayload {
  /** Absolute path under JOB_WORKDIR. The worker refuses anything outside it. */
  path: string;
  olderThanMinutes?: number;
}

export interface SendEmailPayload {
  to: string;
  template: string;
  variables: Record<string, string | number | boolean>;
}

export type SystemJob =
  | { name: typeof SYSTEM_JOB_NAMES.CLEANUP_WORKDIR; data: CleanupWorkdirPayload }
  | { name: typeof SYSTEM_JOB_NAMES.SEND_EMAIL; data: SendEmailPayload };

// -----------------------------------------------------------------------------
// Progress + results
// -----------------------------------------------------------------------------

export const JOB_STAGES = [
  'download',
  'probe',
  'transcribe',
  'translate',
  'render',
  'upload',
  'cleanup',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** Reported via `job.updateProgress()`; surfaced to the UI verbatim. */
export interface JobProgress {
  stage: JobStage;
  /** 0-100, monotonically non-decreasing across the whole job. */
  percent: number;
  message?: string;
}

export interface JobResult {
  jobId: UUID;
  status: Extract<JobStatus, 'succeeded' | 'failed'>;
  assets: MediaAsset[];
  transcript?: Transcript;
  durationMs: number;
  /** Present only when status is `failed`. */
  error?: JobError;
}

export interface JobError {
  code: string;
  message: string;
  /** True when a retry could plausibly succeed (network, rate limit, OOM). */
  retryable: boolean;
}
