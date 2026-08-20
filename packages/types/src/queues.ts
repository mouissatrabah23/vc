/**
 * Queue and job-name constants.
 *
 * apps/api (producer) and apps/worker (consumer) both import from here, so a
 * renamed queue is a compile error rather than a silently orphaned job.
 */

export const QUEUE_NAMES = {
  /** Long-running krillinai-cli pipelines: transcribe, translate, render. */
  MEDIA: 'media',
  /** Short bookkeeping tasks: emails, webhook fan-out, cleanup. */
  SYSTEM: 'system',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const MEDIA_JOB_NAMES = {
  TRANSCRIBE: 'media.transcribe',
  TRANSLATE: 'media.translate',
  RENDER_SUBTITLES: 'media.render-subtitles',
} as const;

export type MediaJobName = (typeof MEDIA_JOB_NAMES)[keyof typeof MEDIA_JOB_NAMES];

export const SYSTEM_JOB_NAMES = {
  CLEANUP_WORKDIR: 'system.cleanup-workdir',
  SEND_EMAIL: 'system.send-email',
} as const;

export type SystemJobName = (typeof SYSTEM_JOB_NAMES)[keyof typeof SYSTEM_JOB_NAMES];

export type JobName = MediaJobName | SystemJobName;

/**
 * Default BullMQ job options. Producers spread these and override per call.
 * Declared here (not in the api) so the worker's retry expectations and the
 * producer's retry policy cannot disagree.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  /** Keep a bounded window of finished jobs for debugging, then evict. */
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
} as const;
