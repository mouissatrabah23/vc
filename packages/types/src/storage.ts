/** Cloudflare R2 (S3-compatible) storage contracts. */

import type { ISODateString } from './common.js';

/**
 * Object key layout. Keys are opaque to the browser — it only ever sees
 * presigned URLs or the public base URL.
 *
 *   uploads/{userId}/{projectId}/{uuid}.{ext}
 *   outputs/{userId}/{projectId}/{jobId}/{name}.{ext}
 */
export const STORAGE_PREFIXES = {
  UPLOADS: 'uploads',
  OUTPUTS: 'outputs',
} as const;

export type StoragePrefix = (typeof STORAGE_PREFIXES)[keyof typeof STORAGE_PREFIXES];

export interface StorageObjectRef {
  bucket: string;
  key: string;
  sizeBytes?: number;
  contentType?: string;
  etag?: string;
}

/** Issued by the API so the browser uploads straight to R2, bypassing the API. */
export interface PresignedUpload {
  key: string;
  url: string;
  method: 'PUT';
  /** Headers the client MUST replay verbatim or the signature check fails. */
  headers: Record<string, string>;
  expiresAt: ISODateString;
  maxSizeBytes: number;
}

export interface PresignedDownload {
  key: string;
  url: string;
  expiresAt: ISODateString;
}

export interface CreateUploadRequest {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}
