# SaaS Monorepo

A pnpm workspace driven by Turborepo: a Next.js front end, an Express REST API,
and a BullMQ worker that shells out to `krillinai-cli`.

**Status: scaffolding.** The structure, shared contracts, build pipeline and
local dev loop are complete and verified. Business logic is deliberately absent
— API routes return `501 Not Implemented` and job processors throw
`UnimplementedProcessorError`, so the gaps are loud rather than silent.

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Everyday commands](#everyday-commands)
- [Repository layout](#repository-layout)
- [Environment variables](#environment-variables)
- [Local infrastructure](#local-infrastructure)
- [Building the worker image](#building-the-worker-image)
- [Design decisions](#design-decisions)
- [Troubleshooting](#troubleshooting)
- [Next steps](#next-steps)

---

## Architecture

```
                    ┌──────────────────┐
   browser ────────▶│  apps/web        │  Next.js 15 App Router
                    │  :3000           │  Tailwind + shadcn/ui
                    └────────┬─────────┘
                             │  HTTP (typed via @saas/types)
                             ▼
                    ┌──────────────────┐
                    │  apps/api        │  Express — owns HTTP, auth,
                    │  :4000           │  Chargily. Enqueues only.
                    └───┬──────────┬───┘
                        │          │
             Prisma     │          │  BullMQ produce
                        ▼          ▼
                 ┌───────────┐  ┌─────────┐
                 │ Postgres  │  │  Redis  │
                 │  :5432    │  │  :6379  │
                 └───────────┘  └────┬────┘
                        ▲            │  BullMQ consume
                        │            ▼
                        │   ┌──────────────────┐
                        └───┤  apps/worker     │  runs krillinai-cli
                            │  (non-root)      │  as uid 10001
                            └──────────────────┘
```

The API never does long-running work. It writes a `Job` row and enqueues; the
worker consumes, runs the CLI in an isolated scratch directory, and reports
progress back through BullMQ. A slow transcode can therefore never occupy an
HTTP request.

---

## Prerequisites

| Tool    | Version    | Notes                                              |
| ------- | ---------- | -------------------------------------------------- |
| Node.js | ≥ 20.11    | 22 LTS recommended                                 |
| pnpm    | 9.15.4     | Installed automatically by Corepack — see below    |
| Docker  | any recent | Only for local Postgres/Redis and the worker image |

pnpm is pinned via the `packageManager` field, so Corepack fetches the exact
version:

```bash
corepack enable
```

<details>
<summary>Windows: <code>corepack enable</code> fails with EPERM</summary>

Corepack writes shims into the Node install directory, which needs elevation.
Either run the command from an admin terminal, or install the shims somewhere
user-writable and add that to your `PATH`:

```powershell
corepack enable --install-directory "$env:LOCALAPPDATA\corepack-shims"
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"   # add permanently via System Settings
```

</details>

---

## Quick start

```bash
# 1. Environment — do this first; several scripts read the root .env
cp .env.example .env

# 2. Dependencies for all five workspaces
pnpm install

# 3. Local Postgres + Redis
docker compose up -d

# 4. Create the database schema
pnpm db:push

# 5. Run everything
pnpm dev
```

| Service | URL                                                          |
| ------- | ------------------------------------------------------------ |
| Web     | http://localhost:3000                                        |
| API     | http://localhost:4000/healthz · http://localhost:4000/readyz |
| Worker  | no HTTP surface — watch the terminal                         |

`pnpm dev` runs all three apps plus watch-mode compilation of the shared
packages. Turborepo builds `packages/types` and `packages/db` first, so editing
a shared type recompiles it and the consuming apps pick it up on the next
reload.

**Verify it is alive:**

```bash
curl http://localhost:4000/healthz   # {"ok":true,"data":{"status":"ok",...}}
curl http://localhost:4000/readyz    # checks Postgres + Redis, 503 if either is down
```

---

## Everyday commands

Run from the repo root.

| Command                    | What it does                                           |
| -------------------------- | ------------------------------------------------------ |
| `pnpm dev`                 | All apps in watch mode                                 |
| `pnpm build`               | Build every workspace in dependency order              |
| `pnpm typecheck`           | `tsc --noEmit` everywhere                              |
| `pnpm lint`                | ESLint (web)                                           |
| `pnpm format`              | Prettier, whole repo                                   |
| `pnpm clean`               | Delete build output and caches                         |
| `pnpm db:generate`         | Regenerate the Prisma client after a schema edit       |
| `pnpm db:push`             | Sync the schema to the dev database, no migration file |
| `pnpm db:migrate`          | Create and apply a named migration                     |
| `pnpm db:studio`           | Prisma Studio on http://localhost:5555                 |
| `pnpm docker:up` / `:down` | Start / stop Postgres + Redis                          |
| `pnpm docker:reset`        | Stop **and drop all data**                             |

Scope any task to one workspace with a filter:

```bash
pnpm --filter @saas/api dev
pnpm --filter @saas/worker build
pnpm --filter "@saas/worker..." build   # the worker plus its dependencies
```

---

## Repository layout

```
.
├── apps/
│   ├── web/                    Next.js 15, App Router, Tailwind, shadcn/ui
│   │   ├── src/app/            routes, layout, globals.css (design tokens)
│   │   ├── src/components/ui/  shadcn components (button, card)
│   │   ├── src/lib/            cn() helper, typed API client
│   │   └── components.json     shadcn CLI config — `pnpm dlx shadcn@latest add …`
│   │
│   ├── api/                    Express REST API
│   │   ├── src/app.ts          middleware stack and router mounting
│   │   ├── src/index.ts        listen + graceful shutdown
│   │   ├── src/env.ts          dotenv + zod, validated at boot
│   │   ├── src/queue.ts        BullMQ producers (type-safe enqueue)
│   │   ├── src/http/           error envelope, request id, error handler
│   │   └── src/routes/         health probes + v1 surface (all 501 for now)
│   │
│   └── worker/                 BullMQ consumer
│       ├── src/index.ts        worker bootstrap + graceful drain
│       ├── src/krillinai.ts    the single process boundary to the CLI
│       ├── src/workdir.ts      per-job scratch dirs, path-escape guards
│       ├── src/processors/     one dispatch table per queue
│       ├── docker/             config.toml template + startup entrypoint
│       └── Dockerfile          builds krillinai-cli from source, uid 10001
│
├── packages/
│   ├── types/                  @saas/types — shared contracts, zero deps
│   └── db/                     @saas/db — Prisma schema + client singleton
│
├── docker-compose.yml          local Postgres + Redis (+ optional admin UIs)
├── turbo.json                  task graph and cache boundaries
├── tsconfig.base.json          strict TS settings every workspace extends
└── .env.example                every variable, documented
```

### The shared packages

**`@saas/types`** holds everything that crosses a process boundary: the HTTP
response envelope, queue and job names, job payloads, billing and storage
shapes. It has no runtime dependencies and never imports `@saas/db`, so the
browser bundle cannot accidentally pull in Prisma. Because the API and the
worker both import `QUEUE_NAMES` and the `MediaJob` union, renaming a job is a
compile error rather than a job that vanishes into Redis.

**`@saas/db`** owns the Prisma schema and exports a `PrismaClient` singleton
cached on `globalThis` in development. Without that cache, every HMR reload
opens a fresh connection pool and exhausts Postgres within a few saves.

```ts
import { prisma, checkDatabase } from "@saas/db";
import { QUEUE_NAMES, type MediaJobPayload } from "@saas/types";
```

---

## Environment variables

There is **one** `.env`, at the repo root. Each workspace reaches it
differently, and in every case real environment variables win over the file —
which is how production supplies configuration:

| Workspace     | How it loads the root `.env`                           |
| ------------- | ------------------------------------------------------ |
| `apps/api`    | `src/env.ts` — dotenv, then zod validation at boot     |
| `apps/worker` | `src/env.ts` — dotenv, then zod validation at boot     |
| `apps/web`    | `next.config.mjs` — dotenv, before the config is built |
| `packages/db` | `dotenv-cli` inside the `db:*` scripts                 |

`.env.example` documents every variable inline. The groups are: runtime, service
URLs, database, Supabase, Redis, Chargily, Cloudflare R2, worker runtime,
krillinai provider credentials, and build-time args.

The krillinai provider keys are a special case: `KRILLINAI_LLM_API_KEY` and
`KRILLINAI_TTS_PROVIDER_KEY` are **not** read by the Node worker at all. The
container entrypoint substitutes them into `config.toml` at startup, and the
worker only declares them so a missing key is reported once at boot rather than
as an opaque CLI failure on the first job.

Two rules worth repeating:

- **`NEXT_PUBLIC_*` is public.** It is inlined into the browser bundle at build
  time. `SUPABASE_SERVICE_ROLE_KEY` bypasses all Row Level Security and must
  never carry that prefix.
- **`DATABASE_URL` and `DIRECT_URL` differ on Supabase.** The first is the
  pooled PgBouncer connection (port 6543) used for queries; the second is the
  direct session connection (port 5432) that Prisma Migrate needs, because DDL
  cannot run through a transaction pooler. Locally they are identical.

The API and worker exit immediately with a readable list of problems if a
required variable is missing, rather than surfacing `undefined` mid-request.

### Moving from local Postgres to Supabase

Only `.env` changes. Point `DATABASE_URL`/`DIRECT_URL` at the Supabase strings,
then `pnpm db:deploy` to apply migrations. No application code is affected.

---

## Local infrastructure

`docker-compose.yml` provides Postgres 16 and Redis 7 — infrastructure only.
The apps run on the host so you keep fast HMR and attachable debuggers.

```bash
docker compose up -d              # start
docker compose ps                 # health status
docker compose logs -f redis
docker compose down               # stop, keep data
docker compose down -v            # stop and DROP all data
```

Redis is configured for BullMQ specifically: `--maxmemory-policy noeviction` so
queue keys are never evicted under memory pressure, `--appendonly yes` so jobs
survive a restart, and `--notify-keyspace-events Ex` for delayed-job handling.

Optional admin UIs are behind a profile:

```bash
docker compose --profile tools up -d
# Adminer       http://localhost:8080  (server: postgres, user/pass: postgres)
# RedisInsight  http://localhost:5540
```

---

## Building the worker image

The worker is the only app that ships as a container at this stage: it needs
the `krillinai-cli` binary, ffmpeg and yt-dlp. **The build context is the repo
root**, not `apps/worker` — the build needs the workspace manifests and the
shared packages:

```bash
docker build -f apps/worker/Dockerfile -t saas-worker:local .

docker run --rm --env-file .env \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/saas_dev \
  -v saas-models:/app/models \
  -v saas-bin:/app/bin \
  saas-worker:local
```

`host.docker.internal` reaches the compose services on your host; on Linux add
`--add-host=host.docker.internal:host-gateway`.

### ⚠ The build requires network access to github.com

Unlike the other images, this one **compiles krillinai-cli from source at build
time**. Two stages reach out to github.com:

| Stage               | Fetches                                                  |
| ------------------- | -------------------------------------------------------- |
| `krillinai-builder` | `git clone https://github.com/krillinai/KrillinAI.git`   |
| `ytdlp`             | a `yt-dlp` release asset from `github.com/yt-dlp/yt-dlp` |

Consequences worth planning for:

- **The build fails behind a firewall that blocks github.com**, and on CI
  runners without egress. It is not cached in any registry you control.
- **Go module downloads** additionally hit `proxy.golang.org`. Set `GOPROXY` to
  an internal proxy if that is also blocked.
- **For an air-gapped builder**, mirror the repo internally and override
  `--build-arg KRILLINAI_REPO=https://git.internal/mirror/KrillinAI.git`, then
  supply yt-dlp from an internal artifact store by editing the `ytdlp` stage.
- **The first build is slow** (a full Go toolchain compile). The Go module and
  build caches are BuildKit cache mounts, so rebuilds are much faster as long
  as the builder keeps its cache.

### Reproducibility: pin, never track a branch

```dockerfile
ARG KRILLINAI_REF=5090acc9c3df28439237ec93d0667f39ad896989
```

That is the commit tag `v2.1.0` (2026-06-17) dereferences to. It is a full
commit SHA rather than `master` or even the tag on purpose: a branch means the
same `docker build` silently produces a different binary tomorrow, and tags can
be force-moved, whereas a SHA cannot. Bump it deliberately, and diff upstream
`config/config-example.toml` against `apps/worker/docker/config.toml.template`
when you do.

Build arguments are documented in [apps/worker/README.md](apps/worker/README.md).

### Configuration is rendered at startup, never baked

`apps/worker/docker/config.toml.template` is committed with `${VAR}`
placeholders and contains no secrets. At container startup `entrypoint.sh` runs
`envsubst`, writes `/app/config/config.toml` with `umask 077` + `chmod 600`,
then `exec`s the CMD.

Baking `KRILLINAI_LLM_API_KEY` into a layer would expose it to anyone able to
pull the image: `docker history` and a layer extract both reveal it, and the
value persists in the registry even if a later layer deletes the file.

### Sandboxing

`krillinai-cli` processes untrusted user uploads, so the image constrains it:

- Runs as `krillin`, uid/gid **10001**, with no login shell — never root.
- Application code and `node_modules` are root-owned and read-only to that
  user. A CLI compromise cannot modify the code that invokes it.
- Writable paths are only `/app/config` (0700, the rendered secrets),
  `/app/work` (0700, `JOB_WORKDIR`), plus the `/app/models` and `/app/bin`
  caches upstream expects. Each job gets its own subdirectory under
  `JOB_WORKDIR`, removed when it settles, and `workdir.ts` rejects any path
  that escapes it.
- `runKrillinai` spawns with `shell: false` — user-controlled arguments such as
  filenames and language codes cannot be injected — and passes an explicit
  environment allow-list, so the CLI never sees database or R2 credentials.
  Provider keys reach it only through the 0600 config file.
- Every invocation is bounded by `KRILLINAI_TIMEOUT_MS` with `SIGKILL`, and
  captured output is capped at 1 MB.
- `tini` is PID 1, so SIGTERM reaches Node (which drains in-flight jobs before
  exiting) and ffmpeg zombies get reaped.

Worth adding at deploy time: `--read-only` with a tmpfs on `/app/work` and
`/app/config`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, and
CPU/memory limits.

---

## Design decisions

**pnpm workspaces + Turborepo.** pnpm's strict, non-hoisted `node_modules`
catches undeclared dependencies on a laptop instead of in a production
container. Turborepo supplies the task graph and caching on top.

**Shared packages are compiled, not source-linked.** `@saas/types` and
`@saas/db` publish `dist/` via an `exports` map. Consumers get real `.d.ts`
files, so Next.js needs no `transpilePackages` entry and `tsc` builds stay fast.

**ESM everywhere.** All workspaces are `"type": "module"` with
`moduleResolution: NodeNext`, which is why relative imports carry a `.js`
extension in `.ts` files. This is TypeScript's required spelling for
Node16/NodeNext resolution, not a mistake.

**Strict TypeScript.** `tsconfig.base.json` enables `noUncheckedIndexedAccess`,
`noUnusedLocals`, `noImplicitOverride` and friends for every workspace. Cheap to
adopt now, expensive to retrofit later.

**Raw request bodies are preserved.** The `express.json` `verify` hook stashes
the raw `Buffer` on the request. Chargily signs webhooks as
`HMAC-SHA256(raw_body, CHARGILY_SECRET_KEY)`; verifying against a re-serialised
object never matches, because key order and whitespace change.

**Graceful shutdown in both services.** The API stops accepting connections and
drains in flight requests; the worker's `close()` waits for running jobs before
resolving. Both then release Redis and Postgres, with a forced-exit timer as a
backstop. Without this, a rolling deploy abandons half-finished transcodes.

**One `.env` at the root.** Four different mechanisms read it (see above), but
there is a single file to edit and a single file to keep out of git.

---

## Troubleshooting

**`Cannot find module … .env` from a `db:*` script**
Those scripts are wrapped in `dotenv -e ../../.env`. Run `cp .env.example .env`.

**`Environment variable not found: DATABASE_URL`**
Same cause. Prisma Migrate additionally needs `DIRECT_URL`.

**`ECONNREFUSED 127.0.0.1:6379` in the API or worker log**
Redis is not running: `docker compose up -d`. The API still serves `/healthz`
(liveness is deliberately dependency-free); `/readyz` reports the outage.

**Worker logs `krillinai-cli not found or not executable`**
Expected outside the container — the binary only exists in the Docker image.
Media jobs fail fast until you run the image.

**`EPERM: operation not permitted, symlink …` during `next build` on Windows**
Next's `output: 'standalone'` creates symlinks, which Windows blocks without
Developer Mode. It is opt-in for that reason — set
`NEXT_OUTPUT_STANDALONE=true` only when building the container image.

**`docker build` fails cloning github.com in the worker image**
The worker Dockerfile compiles krillinai-cli from source and downloads yt-dlp,
so the builder needs egress to github.com (and `proxy.golang.org` for Go
modules). Behind a firewall, mirror the repo and pass
`--build-arg KRILLINAI_REPO=…`.

**Container exits immediately with `no such file or directory`**
A CRLF line ending on `entrypoint.sh`'s shebang — the kernel looks for an
interpreter literally named `/bin/sh
`. `.gitattributes` forces LF for `*.sh`;
if you edited the file with a tool that ignores it, re-save as LF.

**Worker logs `KRILLINAI_LLM_API_KEY is not set`**
The provider keys are consumed by the container entrypoint, not by `pnpm dev`.
Outside Docker this warning is expected; inside, pass `--env-file .env`.

**Prisma types missing after editing the schema**
Run `pnpm db:generate`. `pnpm build` does it automatically as part of
`@saas/db`'s build.

**Stale Turborepo cache**
`pnpm clean && pnpm build`, or `turbo run build --force`.

---

## Next steps

Roughly in dependency order:

1. **Auth** — verify Supabase JWTs in an API middleware using
   `SUPABASE_JWT_SECRET`; attach the user to the request; enable RLS on every
   table the anon key can reach.
2. **Uploads** — implement `POST /api/v1/uploads/presign` against R2 with
   `@aws-sdk/client-s3` (`region: "auto"`, `forcePathStyle: true`).
3. **Job submission** — validate the payload with zod, insert a `Job` row, then
   `enqueueMediaJob`. Store the returned BullMQ id in `Job.queueJobId`.
4. **Worker processors** — fill in `processMediaJob`: download from R2, build
   the `runKrillinai` argument list, upload artifacts, return a `JobResult`.
5. **Progress streaming** — surface `job.updateProgress` to the browser via SSE
   or Supabase Realtime.
6. **Billing** — Chargily checkout creation plus the webhook handler. Verify the
   signature against `req.rawBody`, and use the `WebhookEvent` unique
   constraint on `(provider, eventId)` for idempotency on retries.
7. **Tests and CI** — Vitest per workspace, `pnpm build && pnpm typecheck &&
pnpm lint` in CI, Turborepo remote caching.

---

## Verified

`pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint` and
`pnpm format:check` all pass. The compiled API and worker were smoke-tested:
`/healthz` returns 200, scaffolded routes return 501, unknown routes 404, and
the worker registers both queue consumers.

The krillinai pins were checked against the live upstream repository rather than
assumed: `./cmd/cli` exists, `go.mod` declares `go 1.22` (which is why the
builder is `golang:1.22`), tag `v2.1.0` dereferences to commit
`5090acc9…`, and `docker/config.toml.template` mirrors the real
`config/config-example.toml` schema at that commit. `entrypoint.sh` was executed
locally: it renders valid TOML, substitutes every placeholder, and applies the
transcribe-key fallback.

**Not execute-verified:** Docker was unavailable on the machine used to scaffold
this, so no stage of the image has actually been built — including the Go
compile and the yt-dlp download. Also unverified: how the CLI locates its config
file at runtime (see the Known gap in
[apps/worker/README.md](apps/worker/README.md)).
