/**
 * Credit pricing.
 *
 * This module is the ONLY place a credit rate is read. Rates come from the
 * environment (see env.ts) so the provisional numbers can be replaced without a
 * code change, once a real provider invoice exists to base them on.
 *
 * SHAPE OF THE FORMULA
 * --------------------
 *   credits = max(MIN_CREDITS_PER_TASK, ceil(durationSeconds / 60) × rate[mode])
 *
 * Per-mode rather than flat, because SUBTITLES_ONLY skips speech synthesis and
 * the video render — the two stages that dominate provider cost. A single flat
 * rate would make every subtitle customer subsidise every dubbing customer.
 *
 * WHY INTEGER ARITHMETIC
 * ----------------------
 * Credits land in `tasks.credits_cost numeric(10,2)`. Binary floating point
 * cannot represent most two-decimal values exactly: at a rate of 0.70, three
 * billable minutes is `0.7 * 3 === 2.0999999999999996`, not 2.1.
 *
 * Formatting usually hides that — `toFixed(2)` rounds it back to "2.10" — which
 * is exactly why it is worth avoiding rather than patching. Comparisons are not
 * formatted: `affordable` is a `balance >= cost` test, and at an exact balance
 * a result that is one ulp high denies a user credits they demonstrably have.
 * The same drift decides whether `deduct_credits` is asked for 2.1 or
 * 2.0999999999999996 later.
 *
 * So everything below works in integer hundredths and formats back to a decimal
 * string only at the boundary. No price is ever a JS float.
 */

import type { CreditQuote, TaskMode } from '@saas/types';
import { TASK_MODES } from '@saas/types';
import { env } from './env.js';

/** Accepts what Postgres numeric(10,2) and our env validator both produce. */
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * `"1.25"` -> `125`. Throws rather than returning NaN: a price that silently
 * became NaN would propagate into a charge.
 */
export function parseHundredths(decimal: string): number {
  if (!DECIMAL_PATTERN.test(decimal)) {
    throw new Error(`Not a 2-decimal value: ${decimal}`);
  }

  const [whole = '0', fraction = ''] = decimal.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** `125` -> `"1.25"`. Always two fraction digits, so output is stable. */
export function formatHundredths(hundredths: number): string {
  if (!Number.isInteger(hundredths) || hundredths < 0) {
    throw new Error(`Not a whole number of hundredths: ${hundredths}`);
  }

  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Billable minutes: duration rounded UP, floored at one.
 *
 * Rounding up is the honest default for a provider cost measured per minute —
 * a 61-second clip really does consume two minutes of API time. The floor stops
 * a 3-second test clip pricing at zero, which the schema would happily store
 * (`tasks_credits_cost_non_negative_ck` permits 0) and which would let anyone
 * process unlimited short files for free.
 */
export function billableMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Duration must be a positive number of seconds: ${durationSeconds}`);
  }

  return Math.max(1, Math.ceil(durationSeconds / 60));
}

/**
 * The configured rate for a mode.
 *
 * The `never` branch is load bearing: add a variant to the Prisma `TaskMode`
 * enum (and its mirror in @saas/types) and this stops compiling until a rate is
 * configured for it. A new mode cannot ship silently priced at zero.
 */
function rateFor(mode: TaskMode): string {
  switch (mode) {
    case 'FULL_PIPELINE':
      return env.CREDITS_PER_MINUTE_FULL_PIPELINE;
    case 'SUBTITLES_ONLY':
      return env.CREDITS_PER_MINUTE_SUBTITLES_ONLY;
    default: {
      const unhandled: never = mode;
      throw new Error(`No credit rate configured for task mode: ${String(unhandled)}`);
    }
  }
}

/** Price one mode. `balanceHundredths` only decides `affordable`. */
export function quoteFor(
  mode: TaskMode,
  durationSeconds: number,
  balanceHundredths: number,
): CreditQuote {
  const minutes = billableMinutes(durationSeconds);
  const rate = rateFor(mode);
  const charged = Math.max(
    parseHundredths(rate) * minutes,
    parseHundredths(env.MIN_CREDITS_PER_TASK),
  );

  return {
    mode,
    credits: formatHundredths(charged),
    creditsPerMinute: rate,
    billableMinutes: minutes,
    affordable: balanceHundredths >= charged,
  };
}

/**
 * Price every mode at once.
 *
 * The duration was expensive to obtain (a network probe); pricing both modes
 * from it costs nothing and saves the UI a second round trip to answer
 * "what would the other option cost?".
 */
export function quoteAllModes(durationSeconds: number, balanceHundredths: number): CreditQuote[] {
  return TASK_MODES.map((mode) => quoteFor(mode, durationSeconds, balanceHundredths));
}
