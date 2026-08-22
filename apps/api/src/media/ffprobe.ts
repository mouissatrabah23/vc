/**
 * ffprobe wrapper — reads real media properties out of a stored object.
 *
 * WHY PROBE AT ALL
 * ----------------
 * Duration is the billing unit, so it has to come from the bytes, not from the
 * client. Everything a browser tells us about a file is a claim; ffprobe reading
 * the stored object is the only statement about it we can charge against.
 *
 * WHY OVER THE NETWORK
 * --------------------
 * The API never has the file locally — the browser uploads straight to R2. So
 * ffprobe is pointed at a short-lived presigned GET URL and uses HTTP range
 * requests to read the container header, typically a few hundred KB rather than
 * the whole file. (A progressive MP4 with its `moov` atom at the end costs a
 * second range request for the tail. Still not a download.)
 */

import { spawn } from 'node:child_process';
import { z } from 'zod';
import { env } from '../env.js';
import { AppError } from '../http/errors.js';
import { logger } from '../logger.js';

/** Enough of ffprobe's JSON to price and validate an upload. */
const ffprobeStreamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.string().optional(),
});

const ffprobeOutputSchema = z.object({
  streams: z.array(ffprobeStreamSchema).default([]),
  format: z
    .object({
      format_name: z.string().optional(),
      duration: z.string().optional(),
    })
    .default({}),
});

export interface ProbeResult {
  durationSeconds: number;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** Stop reading a runaway or hostile stdout rather than buffering it all. */
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

const FFPROBE_ARGS = [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  // Bound how much of the file ffprobe will pull while looking for streams.
  // The defaults are generous enough to drag megabytes over the network.
  '-analyzeduration',
  '10M',
  '-probesize',
  '10M',
  // Refuse every protocol except the one we actually hand it. A media file can
  // name other inputs (playlists, `concat:`, `file:`), and without this an
  // uploaded file could make ffprobe open something on the API's own disk.
  '-protocol_whitelist',
  'https,tls,tcp',
];

/**
 * Runs ffprobe against a URL and returns raw stdout.
 *
 * The URL is passed as an argv element to `spawn` with no shell, so its query
 * string — which carries the SigV4 signature, and plenty of `&` and `=` — is
 * never parsed by anything. It is also never logged, for the same reason: a
 * presigned URL in a log file is a working credential for that object.
 */
function runFfprobe(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.FFPROBE_PATH, [...FFPROBE_ARGS, url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let overflowed = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, env.FFPROBE_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > MAX_STDOUT_BYTES) {
        overflowed = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Bounded: ffprobe is run with `-v error`, but a broken file can still be
      // chatty, and this only exists to make the failure message useful.
      if (stderr.length < 8192) stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(
          new AppError(
            'service_unavailable',
            `ffprobe not found at "${env.FFPROBE_PATH}". Install it (apt install -y ffmpeg) or set FFPROBE_PATH.`,
            { cause: error },
          ),
        );
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(
          new AppError(
            'service_unavailable',
            `ffprobe timed out after ${env.FFPROBE_TIMEOUT_MS}ms`,
          ),
        );
        return;
      }

      if (overflowed) {
        reject(new AppError('bad_request', 'Media metadata is implausibly large'));
        return;
      }

      if (code !== 0) {
        // stderr goes to the operator log; the client gets the generic message
        // from the AppError below, because ffprobe's diagnostics can echo the
        // URL back at us.
        logger.warn({ exitCode: code, stderr: stderr.trim() }, 'ffprobe failed');
        reject(
          new AppError('bad_request', 'The uploaded file could not be read as audio or video'),
        );
        return;
      }

      resolve(stdout);
    });
  });
}

/**
 * Duration, preferring the container's own value.
 *
 * Some containers (notably raw/streamed formats) carry no duration in
 * `format`, so fall back to the longest stream. Returns 0 when nothing states a
 * duration — the caller rejects that rather than pricing a guess.
 */
function durationOf(parsed: z.infer<typeof ffprobeOutputSchema>): number {
  const fromFormat = Number.parseFloat(parsed.format.duration ?? '');
  if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat;

  let longest = 0;
  for (const stream of parsed.streams) {
    const value = Number.parseFloat(stream.duration ?? '');
    if (Number.isFinite(value) && value > longest) longest = value;
  }
  return longest;
}

/** Probes a presigned URL and returns the properties we bill and validate on. */
export async function probeMediaUrl(url: string): Promise<ProbeResult> {
  const raw = await runFfprobe(url);

  let parsed: z.infer<typeof ffprobeOutputSchema>;
  try {
    parsed = ffprobeOutputSchema.parse(JSON.parse(raw));
  } catch (error) {
    logger.warn({ err: error }, 'ffprobe returned unparseable output');
    throw new AppError('bad_request', 'The uploaded file could not be read as audio or video');
  }

  const video = parsed.streams.find((stream) => stream.codec_type === 'video');
  const audio = parsed.streams.find((stream) => stream.codec_type === 'audio');

  return {
    durationSeconds: durationOf(parsed),
    container: parsed.format.format_name,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    width: video?.width,
    height: video?.height,
    hasAudio: audio !== undefined,
    hasVideo: video !== undefined,
  };
}
