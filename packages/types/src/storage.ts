/** Cloudflare R2 (S3-compatible) storage contracts. */

import type { ISODateString } from './common.js';

/**
 * Object key layout. Keys are opaque to the browser — it only ever sees
 * presigned URLs or the public base URL.
 *
 *   uploads/{userId}/{uuid}.{ext}
 *   outputs/{userId}/{taskId}/{name}.{ext}
 *
 * The user id is the FIRST path segment after the prefix, and that is load
 * bearing rather than cosmetic: the API authorises a key by checking it begins
 * with `uploads/{callerId}/`. A client that hands back someone else's key is
 * rejected on the prefix, before the object is ever read.
 */
export const STORAGE_PREFIXES = {
  UPLOADS: 'uploads',
  OUTPUTS: 'outputs',
} as const;

export type StoragePrefix = (typeof STORAGE_PREFIXES)[keyof typeof STORAGE_PREFIXES];

/**
 * Container types accepted for upload.
 *
 * Advisory only — this is what the browser's file picker should filter on and
 * what the presign endpoint validates the *declared* type against. It is not a
 * security boundary: a client can declare any of these and upload something
 * else. ffprobe reading the stored bytes is the real check.
 */
export const ACCEPTED_UPLOAD_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
] as const;

export type AcceptedUploadContentType = (typeof ACCEPTED_UPLOAD_CONTENT_TYPES)[number];

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
  /**
   * Headers the client MUST replay verbatim or the signature check fails.
   *
   * `content-length` is among them by design: it is bound into the signature,
   * so the declared size becomes the size R2 will accept. A client that lies
   * about how big the file is gets a 403 from R2 rather than a surprise bill.
   */
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

/** Sent once the browser's PUT to R2 has completed, to probe and price it. */
export interface ProbeUploadRequest {
  key: string;
}
