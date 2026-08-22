# SaaS Monorepo

A pnpm workspace driven by Turborepo: a Next.js front end, an Express REST API,
and a BullMQ worker that shells out to `krillinai-cli`.

**Status: early build.** The structure, shared contracts, build pipeline and
local dev loop are complete and verified. Auth + RLS (Phase 1) and media
uploads, probing and credit quoting (Phase 3) are implemented. The rest of the
business logic is deliberately absent — the remaining API routes return
`501 Not Implemented` and job processors throw `UnimplementedProcessorError`,
so the gaps are loud rather than silent.

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

**Develop from inside WSL2, not from the Windows host.** This is a requirement,
not a preference — see [Why WSL-native](#why-wsl-native) below.

| Tool          | Version    | Notes                                                     |
| ------------- | ---------- | --------------------------------------------------------- |
| WSL2 + Ubuntu | any recent | Windows only; on Linux/macOS just use the native OS       |
| Node.js       | >= 20.11   | **installed inside WSL**, 22 LTS recommended              |
| Docker Engine | any recent | inside WSL, or Docker Desktop with WSL integration        |
| pnpm          | 9.15.4     | provisioned by Corepack, see below                        |
| ffmpeg        | any recent | supplies `ffprobe`, which the API uses to measure uploads |

### One-time WSL setup

```bash
# inside a WSL (Ubuntu) shell
sudo apt update && sudo apt install -y nodejs npm git docker.io
sudo usermod -aG docker "$USER"     # then close and reopen the shell
```

Corepack shipped with Ubuntu's Node may be too old — versions before ~0.30 carry
npm registry signing keys that have since been rotated, and fail with
`Cannot find matching keyid` when they try to fetch pnpm. Install a current one
without root:

```bash
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
npm install -g corepack@latest
corepack enable --install-directory ~/.npm-global/bin
```

To persist those two exports, put them in **`~/.profile` as well as
`~/.bashrc`** — not `~/.bashrc` alone. Ubuntu's stock `~/.bashrc` starts with

```bash
case $- in
    *i*) ;;
      *) return;;      # <- non-interactive shells stop here
esac
```

so anything appended to the end of it is invisible to `bash -lc`, to scripts,
and to some terminal launchers. The symptom is confusing: `pnpm` works when you
type it, but "command not found" the moment a script or task runner calls it,
and `corepack --version` silently reports the old system copy.

Make the PATH edit idempotent, since a login shell may source both files:

```bash
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
case ":$PATH:" in
  *":$HOME/.npm-global/bin:"*) ;;
  *) export PATH="$HOME/.npm-global/bin:$PATH" ;;
esac
```

Ubuntu's `docker.io` package also omits the buildx and compose plugins, which
`docker compose` and the worker image build both need. Same user-local fix:

```bash
mkdir -p ~/.docker/cli-plugins
curl -fsSL -o ~/.docker/cli-plugins/docker-buildx \
  https://github.com/docker/buildx/releases/download/v0.30.1/buildx-v0.30.1.linux-amd64
curl -fsSL -o ~/.docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64
chmod +x ~/.docker/cli-plugins/docker-*
```

### Network: clamp the WSL MTU

WSL2's `eth0` comes up at MTU 1500, but the real path to the internet is often
smaller. When it is, small requests succeed and large transfers hang forever —
`git push` wedging indefinitely while ignoring SIGTERM, `apt-get` failing to
fetch `.deb` files mid-build, `go mod download` timing out. Nothing reports an
MTU problem; it just looks like flaky internet.

Check the real ceiling (largest payload that survives with DF set, +28 for
headers):

```bash
for s in 1472 1440 1400 1372; do
  ping -c1 -W3 -M do -s $s 1.1.1.1 >/dev/null 2>&1 \
    && { echo "ceiling $((s+28))"; break; }
done
```

If it is below 1500, clamp `eth0` permanently. There is no `mtu=` key in
`wsl.conf`; `[boot] command` is the supported hook and runs as root at distro
start:

```ini
# /etc/wsl.conf
[boot]
systemd=true
command = ip link set dev eth0 mtu 1400
```

Apply with `wsl --shutdown` from PowerShell, then reopen the terminal. Verify
with `ip -o link show eth0`. Editing `/etc/wsl.conf` needs root; from PowerShell
`wsl -d <distro> -u root` gets you there without a password.

### Editor

Install the **WSL** extension for VS Code, then from a WSL shell inside the
project:

```bash
code .
```

VS Code reopens attached to the WSL filesystem and its Docker daemon. The
integrated terminal, the language server, and every `pnpm` script then run in
the same place the database does.

---

## Why WSL-native

The project must live on the **WSL filesystem** (`~/projects/vc`), never under
`/mnt/c/...`. Two independent reasons:

**1. The database is only reachable from where Docker runs.** Postgres runs in a
container inside WSL and publishes on WSL's `localhost`. Prisma, the API and the
worker all need to reach it. Running them from the Windows host puts a VM
boundary in the middle of every connection, and `prisma migrate`, `db:studio`
and `pnpm dev` all break in ways that look like unrelated bugs.

**2. Windows-mounted paths are slow for Node workloads.** Every file operation
under `/mnt/c` crosses a 9p filesystem bridge, and package managers do hundreds
of thousands of them. Measured on this project, same machine, same command:

| `pnpm install` location | Time    |
| ----------------------- | ------- |
| `/mnt/c/...`            | 1m 47s  |
| `~/projects/vc` (ext4)  | **34s** |

The gap widens for `pnpm dev`, where file watching is involved.

> If you have a hard requirement to run something from the Windows host, don't
> straddle the boundary silently — set up explicit forwarding
> (`netsh interface portproxy`, or WSL2 mirrored networking mode) and document
> which tool needs it and why.

---

## Quick start

```bash
# inside WSL, on the WSL filesystem
git clone https://github.com/mouissatrabah23/vc.git ~/projects/vc
cd ~/projects/vc
code .                        # optional: reopen in VS Code attached to WSL

# 1. Environment — do this first; several scripts read the root .env
cp .env.example .env

# 2. Dependencies for all five workspaces
pnpm install

# 3. Local Postgres + Redis
docker compose up -d

# 4. Create the database schema
pnpm db:migrate               # or db:deploy for a non-interactive apply
```

> **Use migrations, never `db:push`.** `db:push` syncs tables only. It skips the
> hand-written migration that enables Row Level Security and creates the credit
> functions, leaving a database that looks correct but has no row level security
> and no `deduct_credits`. See [packages/db/README.md](packages/db/README.md).

```bash
# 5. Run everything
pnpm dev
```

| Service       | URL                                                          |
| ------------- | ------------------------------------------------------------ |
| Web           | http://localhost:3000                                        |
| API           | http://localhost:4000/healthz · http://localhost:4000/readyz |
| Prisma Studio | http://localhost:5555 (`pnpm db:studio`)                     |
| Worker        | no HTTP surface — watch the terminal                         |

WSL2 forwards these to the Windows host, so a Windows browser can open
`http://localhost:3000` normally. If it ever cannot, restart WSL
(`wsl --shutdown` from PowerShell) rather than adding port-forwarding rules.

**Verify it is alive:**

```bash
curl http://localhost:4000/healthz
curl http://localhost:4000/readyz    # database + redis both "ok" when healthy
```

A healthy `/readyz` looks like this — if either dependency reports `down`, the
container for it is not running:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "checks": {
      "database": { "status": "ok", "latencyMs": 4 },
      "redis": { "status": "ok", "latencyMs": 3 }
    }
  }
}
```

---

## Everyday commands

Run from the repo root.

| Command                    | What it does                                        |
| -------------------------- | --------------------------------------------------- |
| `pnpm dev`                 | All apps in watch mode                              |
| `pnpm build`               | Build every workspace in dependency order           |
| `pnpm typecheck`           | `tsc --noEmit` everywhere                           |
| `pnpm lint`                | ESLint (web)                                        |
| `pnpm format`              | Prettier, whole repo                                |
| `pnpm clean`               | Delete build output and caches                      |
| `pnpm db:generate`         | Regenerate the Prisma client after a schema edit    |
| `pnpm db:deploy`           | Apply pending migrations (this is the one you want) |
| `pnpm db:migrate`          | Create and apply a named migration                  |
| `pnpm db:studio`           | Prisma Studio on http://localhost:5555              |
| `pnpm docker:up` / `:down` | Start / stop Postgres + Redis                       |
| `pnpm docker:reset`        | Stop **and drop all data**                          |

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

## Authentication

Supabase Auth (GoTrue) end to end, running locally as a real auth server rather
than a stub — so a sign-up here exercises the same password hashing, JWT shape
and `auth.users` INSERT as hosted Supabase, including the Phase 1 provisioning
trigger.

### Local auth stack

`docker compose up -d` starts two extra services alongside Postgres and Redis:

| Service   | Port | Role                                                       |
| --------- | ---- | ---------------------------------------------------------- |
| `auth`    | 9999 | GoTrue. Owns the `auth` schema and runs its own migrations |
| `gateway` | 8000 | nginx, maps `/auth/v1` onto GoTrue and supplies CORS       |

The gateway exists because `supabase-js` hardcodes `${SUPABASE_URL}/auth/v1`;
a bare GoTrue is not reachable by the client library. It also adds the CORS
headers Kong provides in production — without them every login and signup fails
in the browser with an opaque "Failed to fetch".

The dev JWT secret and the anon/service keys in `.env.example` are generated for
local use and are safe to commit. Replace all three for any deployed
environment.

### Backend

`apps/api` verifies Supabase access tokens locally with `SUPABASE_JWT_SECRET` —
no round-trip to the auth server on the hot path. `requireAuth` attaches the
user; `GET /api/v1/me` returns profile plus wallet.

Reads go through `withUserContext()` from `@saas/db`, which runs the query as
the `authenticated` Postgres role with the caller's id as `auth.uid()`. **Row
Level Security is what enforces ownership, not the `where` clause** — the wallet
lookup in `/me` has no `where: { userId }` at all and still returns only the
caller's row. Both settings are transaction-local, so a pooled connection can
never be handed on still impersonating someone.

Use the plain `prisma` client for privileged backend writes; it connects as the
owner and bypasses RLS by design.

Note the verifier deliberately does **not** check `iss`: locally minted tokens
carry no issuer claim, and requiring one would pass in production while failing
every local token.

### Frontend

- Email/password sign-in and sign-up, shadcn-based forms with zod +
  react-hook-form, validated on blur.
- Google OAuth as an additional option (inert until `GOOGLE_OAUTH_*` is set).
- `src/middleware.ts` runs next-intl first, then refreshes the Supabase session
  onto that same response — reversed, the locale redirect would discard the
  refreshed cookies and log users out hourly. It guards `/{locale}/dashboard`
  and preserves `redirectTo`.
- `useUser()` for rendering, `getServerUser()` for server components. Both use
  `getUser()` rather than `getSession()`, which only decodes the cookie and
  would believe a forged one.

### Locales

Arabic is the default and the UI is written Arabic-first; French is secondary.
`localePrefix: 'always'`, so direction is decided before first paint rather than
corrected after it. Arabic uses IBM Plex Sans Arabic with increased line height;
numerals are forced LTR inside RTL text via `.numeric`.

### Verified

`apps/web/e2e-auth.mjs` drives a real headless browser against the running
stack — 15/15 checks, including an actual sign-up through the form:

- root redirects to `/ar`; Arabic renders `dir=rtl`, French `dir=ltr`
- unauthenticated `/ar/dashboard` redirects to `/ar/login?redirectTo=/ar/dashboard`
- zod blocks a malformed submit with inline messages
- **a real UI sign-up advanced `auth.users`, `public.users` and
  `credit_wallets` by exactly one each**, with `full_name` flowing from the form
  through auth metadata into the trigger-provisioned row and a wallet at 0.00
- the dashboard renders the balance fetched from the API under the user's own token
- a signed-in user is bounced off `/login`; after sign-out the dashboard is
  protected again; the account logs back in under `/fr`
- a wrong password is rejected without revealing whether the account exists

Run it with the stack up:

```bash
docker compose up -d && pnpm dev      # in one shell
cd apps/web && node e2e-auth.mjs      # in another
```

API-level checks (also passing): missing, malformed, wrong-secret, expired, and
anon-role tokens all return 401; two users each see exactly 1 of the 2 existing
rows through RLS.

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
2. ~~**Uploads**~~ — **done.** Two endpoints, both behind `requireAuth`:

   `POST /api/v1/uploads/presign` takes `{ fileName, contentType, sizeBytes }`
   and returns a presigned PUT the browser sends the file to directly; media
   never transits the API. `content-length` is bound into the signature, so the
   size limit is enforced by R2 rather than trusted from the client. The
   filename is used only to recover an extension — the key is
   `uploads/{userId}/{uuid}.{ext}`, and the user id in that path is what
   authorises a later probe.

   `POST /api/v1/uploads/probe` takes `{ key }`, HEADs the stored object for its
   real size, runs `ffprobe` against a short-lived presigned GET to read
   duration and codecs, rejects anything unreadable / silent / over the limits,
   and returns a credit quote for every task mode alongside the wallet balance.
   It writes nothing and is safe to repeat.

   Pricing lives only in `apps/api/src/pricing.ts`, driven by
   `CREDITS_PER_MINUTE_*` and `MIN_CREDITS_PER_TASK`. **Those rates are
   provisional placeholders** pending a measured provider invoice — see the
   notes in `.env.example`. A quote is a display price, not a hold: nothing is
   reserved, so task creation must re-price from the duration it reads and must
   never accept a credit amount from the client.

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

Workspace: `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check`
all pass. The compiled API and worker were smoke-tested: `/healthz` returns 200,
scaffolded routes return 501, unknown routes 404, and the worker registers both
queue consumers.

**The worker image builds and runs.** `docker build` completes end to end:

- `go build ./cmd/cli` succeeds against pinned commit `5090acc9`, producing a
  42 MB static binary. The checkout was confirmed to be that exact commit
  (`2026-06-16`, _"fix: preserve bilingual lines in vertical subtitles"_).
- `yt-dlp` and `ffmpeg` are present; the image runs as `krillin` uid 10001.
- The entrypoint renders `/app/config/config.toml` (mode 0600, owned by 10001)
  from environment variables inside the real container.
- `krillinai-cli --help` and `subtitle --help` run and list the full command
  surface.

**The config-path question is closed with evidence** — the CLI resolves
`./config/config.toml` relative to its working directory; there is no
`--config` flag. See
[apps/worker/README.md](apps/worker/README.md#how-the-cli-finds-its-config-verified)
for the test matrix. `runKrillinai` implements the confirmed behaviour.

### Build environment caveat

Verification ran against Docker Engine inside WSL, not Docker Desktop. That
host had unreliable egress (path MTU 1468 against a 1500 interface), which
caused sporadic failures fetching from `deb.debian.org`, `auth.docker.io`,
`github.com` and `proxy.golang.org`. The Dockerfile now retries the network
steps — apt, git clone and `go mod download` — so a transient failure no longer
costs a full rebuild. On a healthy network none of those retries trigger.
