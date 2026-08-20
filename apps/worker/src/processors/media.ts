/**
 * Media queue processor — SCAFFOLD ONLY.
 *
 * The dispatch table and the job lifecycle (workdir, progress reporting,
 * cleanup) are wired up; the pipeline bodies are left for the next stage.
 *
 * Intended shape of a real processor:
 *   1. download the source from R2 into the job workdir
 *   2. runKrillinai([...]) with args derived from `data.options`
 *   3. upload the produced artifacts back to R2
 *   4. return a JobResult; the `finally` block removes the workdir
 */

import type { Job } from 'bullmq';
import { MEDIA_JOB_NAMES } from '@saas/types';
import type { JobProgress, JobStage, MediaJobPayload } from '@saas/types';
import { logger } from '../logger.js';
import { createJobWorkdir, removeJobWorkdir } from '../workdir.js';

async function report(job: Job, stage: JobStage, percent: number, message?: string): Promise<void> {
  const progress: JobProgress = { stage, percent, message };
  await job.updateProgress(progress);
}

export async function processMediaJob(job: Job<MediaJobPayload>): Promise<unknown> {
  const jobLogger = logger.child({
    queueJobId: job.id,
    jobName: job.name,
    jobId: job.data.jobId,
    requestId: job.data.requestId,
    attempt: job.attemptsMade + 1,
  });

  const workdir = await createJobWorkdir(job.data.jobId);
  jobLogger.info({ workdir }, 'job started');

  try {
    await report(job, 'download', 0, 'preparing');

    switch (job.name) {
      case MEDIA_JOB_NAMES.TRANSCRIBE:
      case MEDIA_JOB_NAMES.TRANSLATE:
      case MEDIA_JOB_NAMES.RENDER_SUBTITLES:
        // Not implemented yet. Throwing a non-retryable marker keeps BullMQ
        // from burning all three attempts on a known gap.
        throw new UnimplementedProcessorError(job.name);
      default:
        throw new Error(`Unknown media job name: ${job.name}`);
    }
  } finally {
    await removeJobWorkdir(workdir);
    jobLogger.info('job finished');
  }
}

export class UnimplementedProcessorError extends Error {
  constructor(jobName: string) {
    super(`Processor for "${jobName}" is not implemented yet`);
    this.name = 'UnimplementedProcessorError';
  }
}
