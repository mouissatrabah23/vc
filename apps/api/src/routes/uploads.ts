/**
 * Upload routes — presign, then probe-and-quote.
 *
 * THE TWO-STEP SHAPE
 * ------------------
 *   1. POST /uploads/presign  -> a signed PUT the browser sends the file to
 *   2. (browser PUTs directly to R2, API not involved)
 *   3. POST /uploads/probe    -> what the file actually is, and what it costs
 *
 * Step 2 bypasses the API entirely, which is the point: media never transits
 * this process. That also means step 1 learns nothing true about the file, so
 * every fact used for billing is established in step 3 by reading the stored
 * bytes.
 *
 * WHAT A QUOTE IS NOT
 * -------------------
 * The quote from step 3 is a display price, not a hold on funds. Nothing is
 * reserved, and the credits are not deducted until a task is created. Task
 * creation must therefore re-price from the duration IT reads, and must never
 * accept a credit amount sent by the client — otherwise the price becomes a
 * client-supplied field.
 */

import { Router } from 'express';
import { z } from 'zod';
import { withUserContext } from '@saas/db';
import { ACCEPTED_UPLOAD_CONTENT_TYPES } from '@saas/types';
import type { UploadQuote } from '@saas/types';
import { asyncHandler } from '../http/middleware.js';
import { AppError, sendSuccess } from '../http/errors.js';
import { requireAuth, requireAuthContext } from '../auth/middleware.js';
import { env } from '../env.js';
import { probeMediaUrl } from '../media/ffprobe.js';
import { parseHundredths, quoteAllModes } from '../pricing.js';
import {
  headUpload,
  isOwnedUploadKey,
  presignDownload,
  presignUpload,
  uploadKeyFor,
} from '../storage/r2.js';

export const uploadsRouter: Router = Router();

uploadsRouter.use(requireAuth);

const presignSchema = z.object({
  /** Used only to recover a file extension; never becomes part of the key. */
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ACCEPTED_UPLOAD_CONTENT_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(env.UPLOAD_MAX_BYTES, `File exceeds the ${env.UPLOAD_MAX_BYTES}-byte upload limit`),
});

/**
 * POST /api/v1/uploads/presign
 *
 * `sizeBytes` is signed into the URL, so this is a real limit rather than a
 * hint: R2 refuses a body of any other length. The content type is checked
 * against the accepted list, but treat that as UX — it is a claim, and only the
 * probe in the next step can contradict it.
 */
uploadsRouter.post(
  '/presign',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuthContext(req);
    const body = presignSchema.parse(req.body);

    const key = uploadKeyFor(userId, body.fileName);
    const upload = await presignUpload({
      key,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });

    // The signed URL is not logged anywhere: until it expires it grants write
    // access to that key to whoever holds it.
    req.log.info({ key, sizeBytes: body.sizeBytes }, 'issued upload signature');

    sendSuccess(res, upload, 201);
  }),
);

const probeSchema = z.object({
  key: z.string().min(1).max(1024),
});

/**
 * POST /api/v1/uploads/probe
 *
 * Reads the stored object, validates it is something the pipeline can process,
 * and prices it in every mode. Safe to call more than once — it writes nothing.
 */
uploadsRouter.post(
  '/probe',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuthContext(req);
    const { key } = probeSchema.parse(req.body);

    // 404 rather than 403 on a key belonging to someone else. A 403 would
    // confirm the key exists, turning this endpoint into an oracle for probing
    // other users' object names.
    if (!isOwnedUploadKey(key, userId)) {
      throw AppError.notFound('Upload not found');
    }

    const object = await headUpload(key);
    if (!object) {
      throw AppError.notFound('Upload not found; the upload may not have completed');
    }

    // R2's own byte count, not the number the client declared at presign time.
    const sizeBytes = object.sizeBytes ?? 0;
    if (sizeBytes <= 0) {
      throw new AppError('bad_request', 'The uploaded file is empty');
    }
    // Defence in depth. The signed content-length should already have made an
    // oversized object impossible, so reaching this is worth knowing about.
    if (sizeBytes > env.UPLOAD_MAX_BYTES) {
      req.log.warn({ key, sizeBytes }, 'stored object exceeds the signed upload limit');
      throw new AppError('bad_request', 'The uploaded file exceeds the size limit');
    }

    // Outlive the probe by a small margin and no more.
    const download = await presignDownload(key, Math.ceil(env.FFPROBE_TIMEOUT_MS / 1000) + 30);
    const probe = await probeMediaUrl(download.url);

    if (probe.durationSeconds <= 0) {
      throw new AppError('bad_request', 'Could not determine the duration of this file');
    }

    // No audio means there is nothing to transcribe, so every mode would fail
    // in the worker after the credits had already been taken. Cheaper to say so
    // now, while the user is still looking at the upload screen.
    if (!probe.hasAudio) {
      throw new AppError('bad_request', 'This file has no audio track to transcribe');
    }

    if (probe.durationSeconds > env.UPLOAD_MAX_DURATION_SECONDS) {
      throw new AppError(
        'bad_request',
        `Media is ${Math.round(probe.durationSeconds)}s; the limit is ${env.UPLOAD_MAX_DURATION_SECONDS}s`,
      );
    }

    // Rounded UP to whole seconds here, once. `tasks.video_duration_seconds` is
    // an Int, so this is the value that will eventually be stored — quoting on
    // anything else would let the quote and the charge disagree for any file
    // with a fractional duration.
    const durationSeconds = Math.ceil(probe.durationSeconds);

    const wallet = await withUserContext(userId, async (tx) =>
      tx.creditWallet.findFirst({ select: { balanceCredits: true } }),
    );
    const balanceCredits = wallet?.balanceCredits.toString() ?? '0';

    const payload: UploadQuote = {
      key,
      media: {
        durationSeconds,
        sizeBytes,
        contentType: object.contentType ?? 'application/octet-stream',
        container: probe.container,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        width: probe.width,
        height: probe.height,
        hasAudio: probe.hasAudio,
      },
      quotes: quoteAllModes(durationSeconds, parseHundredths(balanceCredits)),
      balanceCredits,
    };

    sendSuccess(res, payload);
  }),
);
