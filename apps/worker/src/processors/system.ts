/** System queue processor — SCAFFOLD ONLY (cleanup, transactional email). */

import type { Job } from 'bullmq';
import { SYSTEM_JOB_NAMES } from '@saas/types';
import type { CleanupWorkdirPayload } from '@saas/types';
import { logger } from '../logger.js';
import { removeJobWorkdir } from '../workdir.js';

export async function processSystemJob(job: Job): Promise<unknown> {
  const jobLogger = logger.child({ queueJobId: job.id, jobName: job.name });

  switch (job.name) {
    case SYSTEM_JOB_NAMES.CLEANUP_WORKDIR: {
      const { path: target } = job.data as CleanupWorkdirPayload;
      // removeJobWorkdir refuses any path outside JOB_WORKDIR.
      await removeJobWorkdir(target);
      jobLogger.info({ target }, 'workdir cleaned');
      return { cleaned: target };
    }

    case SYSTEM_JOB_NAMES.SEND_EMAIL:
      jobLogger.warn('send-email processor is not implemented yet');
      return { skipped: true };

    default:
      throw new Error(`Unknown system job name: ${job.name}`);
  }
}
