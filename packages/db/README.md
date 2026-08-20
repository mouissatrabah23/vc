# @saas/db

Prisma schema + the shared `PrismaClient` singleton.

```ts
import { prisma, checkDatabase, disconnectDatabase } from "@saas/db";
```

## Commands

Run from the repo root (they proxy into this package):

| Command            | What it does                                                     |
| ------------------ | ---------------------------------------------------------------- |
| `pnpm db:generate` | Regenerate the client after editing `prisma/schema.prisma`       |
| `pnpm db:push`     | Push the schema to the dev database without creating a migration |
| `pnpm db:migrate`  | Create and apply a named migration (writes `prisma/migrations/`) |
| `pnpm db:studio`   | Open Prisma Studio at http://localhost:5555                      |

Every script is wrapped in `dotenv -e ../../.env`, so the root `.env` is the
only place connection strings live. If a command fails with a missing-file
error, you have not run `cp .env.example .env` yet.

## Two connection strings

`DATABASE_URL` is the pooled connection used for queries; `DIRECT_URL` is the
direct session connection used by Prisma Migrate. Locally they are identical.
On Supabase they differ — `DATABASE_URL` points at PgBouncer on port 6543 and
`DIRECT_URL` at port 5432 — because DDL cannot run through a transaction pooler.

## Switching from local Postgres to Supabase

Only `.env` changes; no code does. Point `DATABASE_URL`/`DIRECT_URL` at the
Supabase strings, then run `pnpm db:deploy` to apply existing migrations.
