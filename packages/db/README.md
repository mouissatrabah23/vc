# @saas/db

Prisma schema, migrations, and the shared `PrismaClient` singleton for the video
translation / dubbing platform. Single currency: DZD.

```ts
import { prisma, checkDatabase, disconnectDatabase } from "@saas/db";
```

## Tables

| Table                 | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `users`               | Mirror of `auth.users`; `id` is the Supabase user id              |
| `credit_wallets`      | One per user. `balance_credits` is a **cache** of the ledger      |
| `wallet_transactions` | Append-only ledger. The authoritative record of every credit move |
| `tasks`               | One krillinai-cli pipeline run                                    |
| `payments`            | Chargily credit purchases, in DZD                                 |
| `webhook_events`      | Idempotency only — rejects duplicate webhook deliveries           |

## Why a ledger, not just a balance column

A mutable `balance_credits` column alone can only ever tell you _what the number
is now_. It cannot tell you how it got there, and it cannot tell you whether it
is right. The ledger makes the balance **derivable and therefore checkable**:

```sql
SELECT SUM(amount) FROM wallet_transactions WHERE wallet_id = $1;
```

Concretely, five failure modes a bare counter cannot survive:

1. **Lost updates.** `UPDATE ... SET balance = balance - 30` from two concurrent
   requests can interleave so one deduction vanishes. Nothing in the schema
   records that it happened, so the loss is undetectable after the fact. With a
   ledger, the rows exist even if the cache is wrong, and the drift is visible.

2. **No audit trail.** "Why does this user have 40 credits?" is unanswerable
   without a ledger. With one it is a query — and for a system taking real money
   from real customers, "we cannot explain your balance" is not an acceptable
   support answer.

3. **Double refunds.** `refund_credits` caps a refund at the net amount actually
   deducted for that task. That check is only possible because prior movements
   are still on record. A counter has nothing to compare against, so a retried
   worker can refund the same failed task repeatedly.

4. **Silent corruption is invisible.** A bug that writes the balance without a
   corresponding movement produces a wrong number that looks exactly like a
   right one. The `wallet_balance_drift` view exists to catch precisely this:

   ```sql
   SELECT * FROM wallet_balance_drift;  -- must always be empty
   ```

   Alert on any row. It means some code path bypassed the credit functions.

5. **Disputes and reconciliation.** Chargily payments must reconcile against
   credits granted. `related_payment_id` and `related_task_id` make that a join
   rather than an investigation.

The cached column is kept because `SUM()` over a growing ledger on every balance
check is wasteful. It is written **only** by the credit functions, which hold a
row lock across both writes — so the cache and the ledger cannot diverge without
a bug, and the drift view catches the bug.

`UPDATE` and `DELETE` on `wallet_transactions` are revoked from every role,
`service_role` included. Corrections are made by appending a compensating row.
A ledger you can edit is not a ledger.

## Credit functions

Both are `SECURITY DEFINER`, pinned `search_path`, and granted to `service_role`
only — never to `authenticated`, or any signed-in user could refund themselves
from the browser.

```sql
SELECT deduct_credits(wallet_id, amount, task_id);  -- boolean
SELECT refund_credits(wallet_id, amount, task_id);  -- boolean
```

**They return `false` instead of raising** for the expected business outcomes —
insufficient funds, over-refund. Raising would abort the caller's whole
transaction and force the API to distinguish "declined" from "database is
broken" by parsing error strings. Genuine faults (missing wallet, non-positive
amount) still raise.

`deduct_credits` takes `SELECT ... FOR UPDATE` on the wallet row **before**
reading the balance. Without that lock two concurrent requests both read the
same balance, both judge it sufficient, and both deduct — spending the same
credits twice. That lock is the entire reason this is a database function
rather than application code.

Verified against a real Postgres: two concurrent deductions of 60 from a balance
of 100 produced exactly one `true`, one `false`, a final balance of 40, and a
single ledger row.

## Row Level Security

RLS is enabled on all six tables. The posture is deny-by-default: privileges are
revoked from `anon`/`authenticated` first, then only `SELECT`-your-own-rows is
granted back.

| Table                 | `authenticated` | `service_role`             |
| --------------------- | --------------- | -------------------------- |
| `users`               | SELECT own      | full                       |
| `credit_wallets`      | SELECT own      | full                       |
| `wallet_transactions` | SELECT own      | SELECT + INSERT (no edits) |
| `tasks`               | SELECT own      | full                       |
| `payments`            | SELECT own      | full                       |
| `webhook_events`      | none            | full                       |

There is deliberately **no** INSERT/UPDATE/DELETE policy anywhere. With RLS on,
an operation with no matching policy is denied, so every write path goes through
the API where pricing and business rules are applied.

`service_role` privileges are granted **explicitly** rather than inherited from
Supabase's default-privilege setup. `BYPASSRLS` exempts a role from row level
security but _not_ from table privileges — a distinction that made the backend
unable to read its own tables until it was fixed, and that would not exist at
all on a plain Postgres (local dev, CI, self-hosted).

## Migrations

| Migration                      | Contents                                       |
| ------------------------------ | ---------------------------------------------- |
| `..._init`                     | Tables, enums, indexes, FKs (Prisma-generated) |
| `..._rls_and_credit_functions` | Everything Prisma cannot express (below)       |

The second migration is hand-written because Prisma's schema language has no
syntax for: FKs into Supabase's `auth` schema, CHECK constraints, triggers, RLS
policies, `GRANT`/`REVOKE`, views, or plpgsql. Prisma applies it verbatim and
will not try to manage its contents, so `prisma migrate dev` will not drop it.

It also holds the signup trigger: an `AFTER INSERT` on `auth.users` that creates
the mirror row **and its wallet** in one step. A user without a wallet is a
broken account — the first `deduct_credits` call would fail on a missing row.

## Commands

Run from the repo root:

| Command            | What it does                                        |
| ------------------ | --------------------------------------------------- |
| `pnpm db:generate` | Regenerate the client after editing `schema.prisma` |
| `pnpm db:migrate`  | Create and apply a migration                        |
| `pnpm db:deploy`   | Apply pending migrations (CI / production)          |
| `pnpm db:studio`   | Prisma Studio at http://localhost:5555              |

Every script is wrapped in `dotenv -e ../../.env`, so the root `.env` is the only
place connection strings live.

**Do not use `db:push` on this schema.** It syncs tables only and will not apply
the RLS migration, leaving a database with no row level security that looks
fine.

## Local development

`docker compose up -d postgres` starts Postgres 16 with
`docker/postgres/init/00-supabase-shim.sql`, which creates a minimal `auth`
schema, `auth.uid()`, and the anon / authenticated / service_role roles. Without
it the RLS migration cannot be applied locally and policy bugs would only surface
against a real Supabase project.

Simulate a signed-in user:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-uuid>"}';
SELECT * FROM tasks;   -- only that user's rows
COMMIT;
```

## Moving to Supabase

Only `.env` changes. Point `DATABASE_URL`/`DIRECT_URL` at the Supabase strings
and run `pnpm db:deploy`. The shim is local-only; Supabase already provides
everything it stubs.
