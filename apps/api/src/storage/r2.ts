/**
 * Cloudflare R2 access — presigning and object metadata.
 *
 * The API never proxies media bytes. It signs a URL, the browser talks to R2
 * directly, and the API only ever handles keys and metadata. A 2 GB upload
 * therefore costs the API one signature, not one long-lived connection.
 */

import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { STORAGE_PREFIXES } from '@saas/types';
import type { PresignedDownload, PresignedUpload, StorageObjectRef } from '@saas/types';
import { env } from '../env.js';
import { AppError } from '../http/errors.js';

interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

/**
 * Resolves and validates R2 configuration at call time rather than at boot.
 *
 * The trade: the API still starts with object storage unconfigured (so auth,
 * health and /me work on a laptop with no Cloudflare account), but the upload
 * routes fail with a 503 naming the missing variables instead of a stack trace
 * about `undefined` credentials. The message reaches the operator through the
 * error log — 5xx bodies are deliberately generic to the client.
 */
function r2Config(): R2Config {
  const endpoint =
    env.R2_ENDPOINT ??
    (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

  const missing: string[] = [];
  if (!env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!env.R2_BUCKET) missing.push('R2_BUCKET');
  if (!endpoint) missing.push('R2_ENDPOINT (or R2_ACCOUNT_ID)');

  if (missing.length > 0 || !endpoint) {
    throw new AppError(
      'service_unavailable',
      `Object storage is not configured; missing: ${missing.join(', ')}`,
    );
  }

  return {
    accessKeyId: env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    bucket: env.R2_BUCKET as string,
    endpoint,
  };
}

let cachedClient: S3Client | undefined;

function s3(config: R2Config): S3Client {
  cachedClient ??= new S3Client({
    // R2 has no regions, but SigV4 requires one in the signature.
    region: 'auto',
    endpoint: config.endpoint,
    // R2 does not serve virtual-host style buckets on the API endpoint.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Since v3.729 the SDK adds `x-amz-checksum-crc32` + the matching
    // `x-amz-sdk-checksum-algorithm` header to every PUT by default. On a
    // presigned URL those headers get folded into the signature, and the
    // browser then has to reproduce a CRC32 it has no reason to compute — R2
    // answers 403 SignatureDoesNotMatch. WHEN_REQUIRED restores the pre-3.729
    // behaviour: checksums only where the operation genuinely mandates one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return cachedClient;
}

/** Only lowercase alphanumerics, so nothing from a filename can shape a path. */
const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return undefined;

  const extension = fileName.slice(dot + 1).toLowerCase();
  return EXTENSION_PATTERN.test(extension) ? extension : undefined;
}

/**
 * Builds the object key for a new upload.
 *
 * The client's filename is used ONLY to recover an extension, and even that is
 * whitelist-filtered. The name itself never reaches the key: user-controlled
 * text in an object path invites traversal (`../`), encoding tricks, and keys
 * that are unusable from a shell. The original name belongs in a column, not
 * in a path.
 */
export function uploadKeyFor(userId: string, fileName: string): string {
  const extension = extensionOf(fileName);
  return `${uploadPrefixFor(userId)}${randomUUID()}${extension ? `.${extension}` : ''}`;
}

export function uploadPrefixFor(userId: string): string {
  return `${STORAGE_PREFIXES.UPLOADS}/${userId}/`;
}

/**
 * Authorises a client-supplied key against the authenticated caller.
 *
 * This is the whole access-control story for probing: the caller may only name
 * an object under their own prefix. Requiring exactly one further segment (no
 * `/`) means a crafted key cannot climb out of the prefix or reach into
 * another user's tree, and cannot address the `outputs/` side at all.
 */
export function isOwnedUploadKey(key: string, userId: string): boolean {
  const prefix = uploadPrefixFor(userId);
  if (!key.startsWith(prefix)) return false;

  const remainder = key.slice(prefix.length);
  return remainder.length > 0 && !remainder.includes('/') && !remainder.includes('..');
}

/**
 * Signs a direct-to-R2 PUT.
 *
 * `content-length` is deliberately in `signableHeaders`. Without it the size
 * limit would be advisory — a client could request a signature for 10 MB and
 * upload 10 GB, and the API would not find out until it probed the object.
 * Signed, the declared size IS the contract: R2 rejects any body of a different
 * length before a byte of it is stored.
 */
export async function presignUpload(params: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<PresignedUpload> {
  const config = r2Config();
  const expiresIn = env.R2_PRESIGN_TTL_SECONDS;

  const url = await getSignedUrl(
    s3(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.sizeBytes,
    }),
    { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
  );

  return {
    key: params.key,
    url,
    method: 'PUT',
    // Lowercase because the signature covers lowercased header names; the
    // client must send these exact values, not merely similar ones.
    headers: {
      'content-type': params.contentType,
      'content-length': String(params.sizeBytes),
    },
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    maxSizeBytes: params.sizeBytes,
  };
}

/**
 * Signs a short-lived GET.
 *
 * `ttlSeconds` is overridable so the probe can mint a URL that outlives the
 * ffprobe timeout by only a small margin. A presigned GET is a bearer
 * credential for the object; the shorter it lives, the less a leaked log line
 * or proxy cache entry is worth.
 */
export async function presignDownload(
  key: string,
  ttlSeconds?: number,
): Promise<PresignedDownload> {
  const config = r2Config();
  const expiresIn = ttlSeconds ?? env.R2_PRESIGN_TTL_SECONDS;

  const url = await getSignedUrl(
    s3(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn },
  );

  return { key, url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

/**
 * Reads stored object metadata. `null` means the object is not there.
 *
 * A missing object is an ordinary outcome — the client may be probing before
 * its PUT finished, or after a failed one — so it is not an exception here. The
 * size this returns is R2's own accounting, which is what gets validated;
 * whatever the client declared at presign time is not evidence.
 */
export async function headUpload(key: string): Promise<StorageObjectRef | null> {
  const config = r2Config();

  try {
    const head = await s3(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));

    return {
      bucket: config.bucket,
      key,
      sizeBytes: head.ContentLength,
      contentType: head.ContentType,
      etag: head.ETag,
    };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === 'NotFound') {
      return null;
    }
    throw error;
  }
}
