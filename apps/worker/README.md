# @saas/worker

BullMQ consumer. Pulls jobs off the `media` and `system` queues and drives
`krillinai-cli` as a child process.

## Local

```bash
pnpm --filter @saas/worker dev
```

Runs against the Redis from `docker compose up -d`. Outside the container there
is no `krillinai-cli` binary and no rendered `config.toml`, so startup logs two
warnings and media jobs fail fast — expected until you run the Docker image.

## Docker

The build context is the **repo root**:

```bash
docker build -f apps/worker/Dockerfile -t saas-worker:local .

docker run --rm --env-file .env \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/saas_dev \
  -v saas-models:/app/models \
  -v saas-bin:/app/bin \
  saas-worker:local
```

`host.docker.internal` reaches the compose services running on your host. On
Linux add `--add-host=host.docker.internal:host-gateway`.

> **The build needs network access to github.com.** It clones
> `krillinai/KrillinAI` and downloads a `yt-dlp` release asset. See the root
> README for the air-gapped notes.

### Build arguments

| Arg                 | Default                                    | Purpose                                             |
| ------------------- | ------------------------------------------ | --------------------------------------------------- |
| `KRILLINAI_REF`     | `5090acc9c3df28439237ec93d0667f39ad896989` | Upstream commit to build (tag `v2.1.0`)             |
| `KRILLINAI_CMD_PKG` | `./cmd/cli`                                | Go package built; repo also has `desktop`, `server` |
| `KRILLINAI_REPO`    | upstream HTTPS URL                         | Point at a fork or an internal mirror               |
| `YT_DLP_VERSION`    | `2026.08.19`                               | Pinned yt-dlp release                               |
| `GO_VERSION`        | `1.22`                                     | Matches upstream `go.mod`                           |
| `CGO_ENABLED`       | `0`                                        | Static binary; set `1` if a dep needs cgo           |

`KRILLINAI_REF` is a full commit SHA on purpose. Tags can be force-moved and
branches move constantly; only a SHA makes `docker build` reproducible. When
bumping it, also diff upstream `config/config-example.toml` against
`docker/config.toml.template`.

## Image stages

| Stage               | Base                    | Produces                                |
| ------------------- | ----------------------- | --------------------------------------- |
| `krillinai-builder` | `golang:1.22-bookworm`  | `/out/krillinai-cli` from pinned source |
| `ytdlp`             | `debian:bookworm-slim`  | pinned `yt-dlp` binary (keeps curl out) |
| `deps`              | `node:22-bookworm-slim` | pnpm install, worker subgraph only      |
| `build`             | ← `deps`                | compiled TS + generated Prisma client   |
| `runtime`           | `node:22-bookworm-slim` | final image, runs as uid 10001          |

Runtime packages mirror upstream's `docker.md` / `Dockerfile`: `ffmpeg`,
`yt-dlp`, CJK + Latin fonts (subtitle burn-in renders tofu boxes without them),
`gettext-base` for `envsubst`, and `tini` as PID 1.

## Configuration: rendered, never baked

Secrets are **not** in the image. `docker/config.toml.template` is committed
with `${VAR}` placeholders; `docker/entrypoint.sh` runs `envsubst` at container
startup and writes `/app/config/config.toml` with `umask 077` + `chmod 600`,
then `exec`s the CMD.

Baking keys into a layer would expose them to anyone who can pull the image —
`docker history` and a layer extract both reveal them, and the value survives
in the registry even if a later layer deletes the file.

| Variable                       | Lands in                                                  |
| ------------------------------ | --------------------------------------------------------- |
| `KRILLINAI_LLM_API_KEY`        | `[llm].api_key`                                           |
| `KRILLINAI_TTS_PROVIDER_KEY`   | `[tts.openai].api_key`                                    |
| `KRILLINAI_TRANSCRIBE_API_KEY` | `[transcribe.openai].api_key` (falls back to the LLM key) |

Missing keys **warn** rather than abort: the worker must still boot and report
health, so jobs fail individually with a clear cause instead of the container
crash-looping.

Inspect a render without starting the worker:

```bash
docker run --rm --env-file .env saas-worker:local sh -c 'cat $KRILLINAI_CONFIG_PATH'
```

## Sandboxing

- Runs as `krillin` (uid/gid 10001), no login shell, never root.
- Application code and `node_modules` are root-owned and read-only to that
  user. A CLI compromise cannot modify the code that invokes it.
- Writable paths are only `/app/config` (0700), `/app/work` (0700),
  `/app/models` and `/app/bin`. Each job gets its own subdirectory under
  `JOB_WORKDIR`, removed when it settles, and `workdir.ts` rejects any path
  that escapes it.
- `runKrillinai` spawns with `shell: false` — user-controlled filenames and
  language codes cannot be injected — and passes an explicit environment
  allow-list, so the CLI sees neither database nor R2 credentials. Provider
  keys reach it only through the 0600 config file.
- Every invocation is bounded by `KRILLINAI_TIMEOUT_MS` with `SIGKILL`, and
  captured output is capped at 1 MB.

Hardening worth adding at deploy time: `--read-only` with a tmpfs on
`/app/work` and `/app/config`, `--cap-drop=ALL`,
`--security-opt=no-new-privileges`, plus CPU and memory limits.

## Layout

| File                          | Role                                                    |
| ----------------------------- | ------------------------------------------------------- |
| `src/index.ts`                | Worker bootstrap, event wiring, graceful drain          |
| `src/krillinai.ts`            | The single process boundary to the CLI, with guardrails |
| `src/workdir.ts`              | Per-job scratch dirs and path-escape checks             |
| `src/processors/*.ts`         | One dispatch table per queue                            |
| `docker/config.toml.template` | Committed config with `${VAR}` placeholders             |
| `docker/entrypoint.sh`        | Renders the config, then `exec`s the CMD                |

## How the CLI finds its config (verified)

`krillinai-cli` resolves configuration from **`./config/config.toml`, relative
to its working directory**. There is no `--config` flag and no config-path
environment variable. Established by running the built image, not by assumption:

| Test | Setup                                             | CLI output                                                       |
| ---- | ------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | job cwd, no `./config`                            | `未找到配置文件` (config file not found), `config/config.go:220` |
| 2    | job cwd + `./config/config.toml`                  | `已找到配置文件` (config file found), `config/config.go:223`     |
| 3    | job cwd + `./config` **symlink** to `/app/config` | found — symlink is honoured                                      |
| 4    | job cwd + invalid TOML at that path               | found, then `加载配置文件失败` with a line-1 parse error         |

Test 1 is the decisive one: `/app/config/config.toml` existed and `--workdir`
pointed at the job directory, yet the CLI still reported "not found". So
`--workdir` is task isolation only — it plays no part in config lookup.

`runKrillinai` therefore symlinks `<job-dir>/config` to the directory holding
the rendered config before spawning. A symlink rather than a copy, so live
provider credentials are not duplicated into every scratch directory.

### The working directory must be writable

During logger init — before argv is parsed — the CLI opens `app.log` in its
working directory. Run it anywhere read-only and it aborts immediately:

```
panic: 无法打开日志文件: open app.log: permission denied
    krillin-ai/log.InitLogger()  log/zap.go:14
    main.main()                  cmd/cli/main.go:17
```

This is why the CLI is never run with `cwd=/app`, where the application code
lives root-owned. Each job's scratch directory is writable by uid 10001.

## Scratch-directory lifecycle (verified)

### Cleanup never follows the config symlink

`removeJobWorkdir` uses `fs.rm(dir, { recursive: true, force: true })`, which
operates on `lstat` semantics: it **unlinks** a symlink rather than descending
into it. Verified against the real function in the built image — after cleaning
a job directory containing the `config` symlink:

| Assertion                                 | Result |
| ----------------------------------------- | ------ |
| job dir removed                           | true   |
| `/app/config/config.toml` still exists    | true   |
| config.toml sha256 unchanged              | true   |
| config.toml inode unchanged               | true   |
| config.toml mtime unchanged               | true   |
| `/app/config` inode and entries unchanged | true   |

This matters because the symlink target holds the platform's provider
credentials for **every** job. Following it during cleanup would destroy them
once and break all subsequent work. `resolveWithinWorkdir` is a second layer of
defence: it refuses any path outside `JOB_WORKDIR`.

### The job directory is writable before the CLI starts

`createJobWorkdir` runs before any spawn and creates the directory `0700`,
owned by the worker user. Measured in-container: mode `0700`, uid `10001`,
process uid `10001`, `W_OK|X_OK` satisfied **before** `runKrillinai` is called.

This ordering is load-bearing. The CLI opens `app.log` in its working directory
during logger init, before argv is parsed, so a non-writable cwd kills it
outright — see the panic documented above.

### Where app.log goes, and what to keep

`app.log` is written **inside the job directory** (mode `0600`) and is therefore
deleted along with the rest of the scratch directory when the job settles.

That loses nothing, because the CLI writes its structured logs to **both**
`app.log` and stdout, and `runKrillinai` already captures stdout and stderr.
Forward those into the worker's own logger rather than trying to preserve the
file.

The one case `app.log` can never cover is a pre-argv panic: the panic happens
_because_ the log file could not be created, so no file exists. Such panics go
to **stderr** with exit code `2`, and `runKrillinai` surfaces them on
`KrillinaiError.stderr` — verified:

```
error name     : KrillinaiError
exitCode       : 2
stderr captured: "panic: 无法打开日志文件: open app.log: permission denied"
```

So early panics are visible to our own logging, not silent. Persisting
`app.log` would only be worth it if you want the CLI's own log file attached to
failed jobs as an artifact; the information is otherwise already captured.

## `voices` as a health check — local only, zero cost

`krillinai-cli voices` makes **no network call and validates no credentials**.
Verified by running it with the network stack removed entirely:

| Test                              | Result                                              |
| --------------------------------- | --------------------------------------------------- |
| `--network none`                  | exit 0, full 10-voice list returned                 |
| `--network none` + empty API keys | exit 0, list still returned                         |
| DNS check in the same sandbox     | `api.openai.com` unresolvable, confirming no egress |

It is therefore safe as a zero-cost CI or startup probe. **But note what it does
and does not prove**: it returns `{"ok":true}` even with no config file and no
credentials at all. It proves the binary executes and its working directory is
usable — nothing more.

To make it a meaningful config check, assert on the log line rather than the
exit code: config loaded emits `config/config.go:223` / `已找到配置文件`,
while a missing config emits `config/config.go:220` / `未找到配置文件`.
Credential validity can only be established by a real provider call.

## Command surface (from the built binary)

```
krillinai-cli <command> [flags]

  subtitle             Generate source, target, bilingual, and short vertical subtitles
  tts                  Generate target-language dubbing from SRT subtitles
  render-horizontal    Render landscape subtitle or dubbed videos
  render-vertical      Render portrait subtitle or dubbed videos
  pipeline             Plan or run multi-stage workflows when supported
  cover                Generate a cover image from a prompt
  update               Update krillinai-cli from GitHub releases
  voices               List available TTS voice codes
  status               Reserved status query surface
```

`subtitle` flags: `--origin-lang`, `--target-lang`, `--user-lang`, `--workdir`,
`--task-id`, `--caption-source` (any|manual|auto|whisper), `--bilingual-top`,
`--max-word-one-line`, `--subtitle-style-file`, `--dry-run`.

`--dry-run` validates a command without external calls — useful in tests. Note
it returns `{"ok":true,...}` _without_ loading config, so it cannot be used to
verify configuration.
