/**
 * Credit pricing contracts — what a task will cost, quoted before it exists.
 *
 * The API is the only place that knows the rates (they come from the
 * environment, so they can be changed without a deploy). The browser never
 * computes a price; it renders the quote it is handed. That is deliberate: two
 * implementations of the same formula drift, and the one the user sees would be
 * the one that is wrong.
 */

/**
 * Mirrors the Prisma `TaskMode` enum.
 *
 * Duplicated on purpose — this package must not import `@saas/db` (see the
 * rules in index.ts), and the browser needs these names to render mode choices.
 * If the Prisma enum gains a variant, add it here too; the API's exhaustive
 * switch over rates will fail to compile until you do.
 */
export const TASK_MODES = ['FULL_PIPELINE', 'SUBTITLES_ONLY'] as const;
export type TaskMode = (typeof TASK_MODES)[number];

/**
 * A price quote for one processing mode.
 *
 * `credits` and `creditsPerMinute` are decimal STRINGS, never numbers. The
 * column behind them is `numeric(10,2)`; JSON numbers are IEEE-754 doubles,
 * which cannot represent every two-decimal value exactly. Serialising a price
 * as a number is how a quote and a charge end up disagreeing by a centime.
 */
export interface CreditQuote {
  mode: TaskMode;
  credits: string;
  creditsPerMinute: string;
  /** Duration rounded UP to whole minutes, with a floor of one. */
  billableMinutes: number;
  /** False when the caller's current balance is below `credits`. */
  affordable: boolean;
}

/**
 * Everything the client needs to decide whether to submit a task, in one
 * response: what the file actually is, what each mode would cost, and what the
 * wallet currently holds.
 */
export interface UploadQuote {
  /** R2 object key of the probed upload. Pass this back when creating a task. */
  key: string;
  media: ProbedMedia;
  /** One quote per mode, so the UI can price both without a second round trip. */
  quotes: CreditQuote[];
  /** Wallet balance at quote time, as a decimal string. */
  balanceCredits: string;
}

/**
 * Probe result trusted enough to price against.
 *
 * Every field here was read from the stored object by ffprobe, not from
 * anything the client declared. `sizeBytes` is R2's own accounting.
 */
export interface ProbedMedia {
  durationSeconds: number;
  sizeBytes: number;
  contentType: string;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  /** False when the file carries no audio stream — nothing to transcribe. */
  hasAudio: boolean;
}
