/**
 * API v1 router — route surface only.
 *
 * Every handler below is a deliberate 501. The shape of the API is settled
 * here so the web client can be typed against it; the bodies land in the next
 * stage. Add real handlers by replacing the `notImplemented` calls.
 */

import { Router } from 'express';
import { AppError } from '../http/errors.js';
import { asyncHandler } from '../http/middleware.js';
import { meRouter } from './me.js';

export const v1Router: Router = Router();

// --- Projects ---------------------------------------------------------------

const projects: Router = Router();

projects.get(
  '/',
  asyncHandler(async () => {
    throw AppError.notImplemented('List projects');
  }),
);

projects.post(
  '/',
  asyncHandler(async () => {
    throw AppError.notImplemented('Create project');
  }),
);

projects.get(
  '/:projectId',
  asyncHandler(async () => {
    throw AppError.notImplemented('Get project');
  }),
);

// --- Uploads (presigned R2 PUT) --------------------------------------------

const uploads: Router = Router();

uploads.post(
  '/presign',
  asyncHandler(async () => {
    throw AppError.notImplemented('Presigned upload');
  }),
);

// --- Jobs (BullMQ producers) ------------------------------------------------

const jobs: Router = Router();

jobs.post(
  '/',
  asyncHandler(async () => {
    // Will validate the payload, insert a Job row, then call enqueueMediaJob().
    throw AppError.notImplemented('Submit job');
  }),
);

jobs.get(
  '/:jobId',
  asyncHandler(async () => {
    throw AppError.notImplemented('Get job status');
  }),
);

jobs.post(
  '/:jobId/cancel',
  asyncHandler(async () => {
    throw AppError.notImplemented('Cancel job');
  }),
);

// --- Billing (Chargily) -----------------------------------------------------

const billing: Router = Router();

billing.get(
  '/plans',
  asyncHandler(async () => {
    throw AppError.notImplemented('List plans');
  }),
);

billing.post(
  '/checkout',
  asyncHandler(async () => {
    throw AppError.notImplemented('Create Chargily checkout');
  }),
);

// --- Webhooks ---------------------------------------------------------------

const webhooks: Router = Router();

/**
 * Chargily posts here. The raw body is preserved by the express.json `verify`
 * hook in app.ts — HMAC verification must run against the exact bytes sent,
 * not a re-serialised object.
 */
webhooks.post(
  '/chargily',
  asyncHandler(async () => {
    throw AppError.notImplemented('Chargily webhook');
  }),
);

v1Router.use('/me', meRouter);
v1Router.use('/projects', projects);
v1Router.use('/uploads', uploads);
v1Router.use('/jobs', jobs);
v1Router.use('/billing', billing);
v1Router.use('/webhooks', webhooks);
