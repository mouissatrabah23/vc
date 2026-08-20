/** Primitives reused across every other module in this package. */

/** Date serialised over the wire, e.g. `2026-08-21T10:15:00.000Z`. */
export type ISODateString = string;

/** UUID v4, as produced by Postgres `gen_random_uuid()` / Supabase auth. */
export type UUID = string;

/** Opaque cursor for keyset pagination. Never parse this client-side. */
export type Cursor = string;

/** Recursive read-only view — handy for frozen config objects. */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T[K] extends object
      ? DeepReadonly<T[K]>
      : T[K];
};

/** At least one key of T must be present. */
export type RequireAtLeastOne<T, K extends keyof T = keyof T> = Omit<T, K> &
  { [P in K]-?: Required<Pick<T, P>> & Partial<Pick<T, Exclude<K, P>>> }[K];

/** Every entity persisted by the API carries these. */
export interface Timestamped {
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Identified {
  id: UUID;
}

export type Entity = Identified & Timestamped;
