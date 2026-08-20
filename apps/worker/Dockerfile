# syntax=docker/dockerfile:1.7
#
# Worker image = the BullMQ consumer (Node) + krillinai-cli (Go, built from
# source) + the media tooling the CLI shells out to.
#
# BUILD CONTEXT IS THE REPO ROOT, not this directory — the build needs the
# workspace manifests and the shared packages:
#
#   docker build -f apps/worker/Dockerfile -t saas-worker:local .
#
# REQUIRES NETWORK ACCESS TO github.com AT BUILD TIME. Stage `krillinai-builder`
# clones github.com/krillinai/KrillinAI and stage `ytdlp` downloads a release
# asset from github.com/yt-dlp/yt-dlp. An air-gapped builder must vendor both
# and supply them by other means.

ARG GO_VERSION=1.22
ARG NODE_VERSION=22.12.0

# =============================================================================
# Stage 1 — build krillinai-cli from pinned source
# =============================================================================
FROM golang:${GO_VERSION}-bookworm AS krillinai-builder

ARG KRILLINAI_REPO=https://github.com/krillinai/KrillinAI.git

# PINNED, NEVER `master`. This is the commit that tag v2.1.0 (2026-06-17)
# dereferences to. A branch name here would make the image non-reproducible:
# the same `docker build` would silently produce a different binary tomorrow.
# Bump deliberately, and prefer a full commit SHA over a tag — tags can be
# force-moved, commit SHAs cannot.
ARG KRILLINAI_REF=5090acc9c3df28439237ec93d0667f39ad896989

# Upstream's CLI entrypoint. The repo also ships ./cmd/desktop and ./cmd/server.
ARG KRILLINAI_CMD_PKG=./cmd/cli

# Static by default, so the binary does not depend on the runtime image's glibc.
# Override to 1 if a future dependency needs cgo — builder and runtime are both
# bookworm, so a dynamically linked binary would still work.
ARG CGO_ENABLED=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# --no-checkout plus a blob filter fetches history cheaply, then materialises
# exactly one revision. Works whether KRILLINAI_REF is a tag, branch or SHA.
RUN set -eux; \
    git clone --no-checkout --filter=blob:none "${KRILLINAI_REPO}" .; \
    git checkout --detach "${KRILLINAI_REF}"; \
    git --no-pager log -1 --format="krillinai-cli source: %H %cI %s"

# Upstream go.mod declares `go 1.22`, which is why the builder is golang:1.22.
RUN --mount=type=cache,id=gomod,target=/go/pkg/mod \
    --mount=type=cache,id=gobuild,target=/root/.cache/go-build \
    set -eux; \
    CGO_ENABLED="${CGO_ENABLED}" GOOS=linux \
      go build -trimpath -ldflags="-s -w" -o /out/krillinai-cli "${KRILLINAI_CMD_PKG}"; \
    ls -l /out/krillinai-cli

# =============================================================================
# Stage 2 — fetch a pinned yt-dlp
# =============================================================================
# Isolated so curl never reaches the runtime image. yt-dlp ships self-contained
# PyInstaller builds, so the runtime needs no Python interpreter.
FROM debian:bookworm-slim AS ytdlp

ARG YT_DLP_VERSION=2026.08.19
# Supplied automatically by BuildKit.
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) asset=yt-dlp_linux ;; \
      arm64) asset=yt-dlp_linux_aarch64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH:-unset}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 --retry-delay 2 \
      -o /out-ytdlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${asset}"; \
    chmod 0755 /out-ytdlp; \
    /out-ytdlp --version

# =============================================================================
# Stage 3 — install the Node workspace dependencies
# =============================================================================
FROM node:${NODE_VERSION}-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

# corepack pins pnpm to the root package.json `packageManager` field, so the
# image and a developer laptop resolve the identical pnpm version.
RUN corepack enable

WORKDIR /repo

# Manifests only, so this layer stays cached until a dependency really changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY apps/worker/package.json ./apps/worker/

# `@saas/worker...` (trailing dots) selects the worker plus its workspace
# dependencies — apps/web and apps/api never enter this image.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@saas/worker..."

# =============================================================================
# Stage 4 — compile the worker and generate the Prisma client
# =============================================================================
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/types ./packages/types
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

# `prisma generate` only reads the schema, but the datasource block must
# resolve. This placeholder never opens a connection — the real DATABASE_URL
# arrives as a runtime environment variable.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
    DIRECT_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder

RUN pnpm --filter "@saas/types" run build \
    && pnpm --filter "@saas/db" run build \
    && pnpm --filter "@saas/worker" run build

# =============================================================================
# Stage 5 — runtime
# =============================================================================
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# Runtime dependencies, mirroring upstream's own docker.md / Dockerfile:
#   ffmpeg        — every transcode, extract and burn-in step shells out to it
#   yt-dlp        — remote source ingestion (copied from stage 2)
#   fonts         — subtitle burn-in needs CJK + Latin glyphs; without them
#                   ffmpeg silently renders tofu boxes
#   gettext-base  — provides envsubst, used to render config.toml at startup
#   tini          — PID 1 that forwards signals and reaps ffmpeg zombies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         ca-certificates \
         ffmpeg \
         fonts-dejavu-core \
         fonts-noto-cjk \
         gettext-base \
         tini \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Non-root user for sandboxed CLI execution
# -----------------------------------------------------------------------------
# krillinai-cli processes untrusted user uploads. It runs as `krillin` with a
# fixed uid/gid of 10001, so bind-mounted volumes get predictable ownership,
# with no login shell and no write access to the code it runs from.
RUN groupadd --system --gid 10001 krillin \
    && useradd --system --uid 10001 --gid krillin \
               --home-dir /home/krillin --create-home \
               --shell /usr/sbin/nologin krillin

COPY --from=krillinai-builder --chown=root:root /out/krillinai-cli /usr/local/bin/krillinai-cli
COPY --from=ytdlp --chown=root:root /out-ytdlp /usr/local/bin/yt-dlp
RUN chmod 0755 /usr/local/bin/krillinai-cli /usr/local/bin/yt-dlp

ENV NODE_ENV=production \
    KRILLINAI_CLI_PATH=/usr/local/bin/krillinai-cli \
    KRILLINAI_CONFIG_PATH=/app/config/config.toml \
    KRILLINAI_CONFIG_TEMPLATE=/app/docker/config.toml.template \
    JOB_WORKDIR=/app/work \
    PATH=/app/bin:$PATH

WORKDIR /app

# Application code and node_modules are root-owned and read-only to `krillin`.
#
# NOTE: this copies the full workspace, dev dependencies included. It is the
# variant that behaves identically to local dev — the generated Prisma client
# lives inside pnpm's virtual store, which `pnpm deploy --prod` would strip.
# Slim it with `pnpm deploy` plus a post-deploy `prisma generate` once the
# dependency graph stops moving.
COPY --from=build --chown=root:root /repo /app

# The template is root-owned and read-only to the worker: the process may
# render it, never rewrite it.
COPY --chown=root:root apps/worker/docker/config.toml.template /app/docker/config.toml.template
COPY --chown=root:root apps/worker/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# chmod explicitly: a repo cloned on Windows carries no POSIX exec bit, so
# relying on the checked-in file mode would produce a container that cannot
# start.
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
    && chmod 0444 /app/docker/config.toml.template

# Writable state, all owned by krillin and nothing else:
#   /app/config — the rendered config.toml (holds secrets, mode 0700)
#   /app/work   — per-job scratch space (JOB_WORKDIR)
#   /app/models — fasterwhisper model cache, per upstream docker.md
#   /app/bin    — binaries krillinai-cli downloads for itself, per upstream
RUN mkdir -p /app/config /app/work /app/models /app/bin \
    && chown krillin:krillin /app/config /app/work /app/models /app/bin \
    && chmod 0700 /app/config /app/work \
    && chmod 0755 /app/models /app/bin

VOLUME ["/app/work", "/app/models", "/app/bin"]

USER krillin

# tini as PID 1 forwards SIGTERM to node, which drains in-flight BullMQ jobs
# before exiting (see the shutdown handler in apps/worker/src/index.ts).
# entrypoint.sh renders config.toml from the environment, then execs the CMD.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/worker/dist/index.js"]
