/**
 * Billing contracts (Chargily Pay).
 *
 * Shapes only — no SDK calls, no key handling. The API owns the Chargily
 * integration; the web app renders these types and never sees a secret key.
 */

import type { ISODateString, UUID } from './common.js';

export const PLAN_IDS = ['free', 'starter', 'pro', 'business'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Chargily settles in Algerian dinar; `dzd` is the only live currency. */
export type Currency = 'dzd' | 'usd' | 'eur';

export interface Plan {
  id: PlanId;
  name: string;
  /** Minor units (centimes) to avoid float drift. 250000 = 2 500,00 DZD. */
  priceMinor: number;
  currency: Currency;
  interval: 'month' | 'year';
  /** Monthly processing allowance, in minutes of media. */
  quotaMinutes: number;
  features: string[];
}

export interface Subscription {
  id: UUID;
  userId: UUID;
  planId: PlanId;
  status: SubscriptionStatus;
  currentPeriodStart: ISODateString;
  currentPeriodEnd: ISODateString;
  cancelAtPeriodEnd: boolean;
}

/** Request the web app sends to the API to open a Chargily checkout. */
export interface CreateCheckoutRequest {
  planId: PlanId;
  /** Path within the web app to return to, e.g. `/billing/success`. */
  returnPath?: string;
}

export interface CreateCheckoutResponse {
  checkoutId: string;
  /** Hosted Chargily payment page — redirect the browser here. */
  checkoutUrl: string;
  expiresAt: ISODateString;
}

export const CHARGILY_EVENT_TYPES = [
  'checkout.paid',
  'checkout.failed',
  'checkout.canceled',
  'checkout.expired',
] as const;
export type ChargilyEventType = (typeof CHARGILY_EVENT_TYPES)[number];

/**
 * Inbound Chargily webhook envelope.
 *
 * The `signature` header is HMAC-SHA256 of the RAW request body keyed with
 * CHARGILY_SECRET_KEY — verify against the raw buffer, before JSON parsing.
 */
export interface ChargilyWebhookEvent<TData = Record<string, unknown>> {
  id: string;
  type: ChargilyEventType;
  livemode: boolean;
  createdAt: number;
  data: TData;
}
