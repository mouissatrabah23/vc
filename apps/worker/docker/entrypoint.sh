#!/bin/sh
#
# Renders the krillinai-cli config from environment variables, then execs the
# container CMD. Runs as uid 10001 (krillin) — see apps/worker/Dockerfile.
#
# Why render at startup instead of baking config.toml into the image: an image
# layer is world-readable to anyone who can pull it, and `docker history` plus
# a layer extract will surface a baked key even if a later layer deletes the
# file. Secrets stay in the process environment and in one 0600 file.

set -eu

TEMPLATE="${KRILLINAI_CONFIG_TEMPLATE:-/app/docker/config.toml.template}"
TARGET="${KRILLINAI_CONFIG_PATH:-/app/config/config.toml}"

if [ ! -r "${TEMPLATE}" ]; then
  echo "entrypoint: config template not readable at ${TEMPLATE}" >&2
  exit 1
fi

# Defaults for everything the template interpolates. Without these, `set -u`
# would abort on the first unset variable, and an unset value would otherwise
# render as an empty string with no warning.
: "${KRILLINAI_SEGMENT_DURATION:=5}"
: "${KRILLINAI_TRANSCRIBE_PARALLEL:=1}"
: "${KRILLINAI_TRANSLATE_PARALLEL:=3}"
: "${KRILLINAI_PROXY:=}"

: "${KRILLINAI_LLM_BASE_URL:=https://api.openai.com/v1}"
: "${KRILLINAI_LLM_MODEL:=gpt-4o-mini}"
: "${KRILLINAI_LLM_API_KEY:=}"

: "${KRILLINAI_TRANSCRIBE_PROVIDER:=openai}"
: "${KRILLINAI_TRANSCRIBE_BASE_URL:=${KRILLINAI_LLM_BASE_URL}}"
: "${KRILLINAI_TRANSCRIBE_MODEL:=whisper-1}"
# Transcription usually runs on the same account as the LLM; fall back to it
# rather than forcing operators to set the same key twice.
: "${KRILLINAI_TRANSCRIBE_API_KEY:=${KRILLINAI_LLM_API_KEY}}"

: "${KRILLINAI_TTS_PROVIDER:=openai}"
: "${KRILLINAI_TTS_BASE_URL:=${KRILLINAI_LLM_BASE_URL}}"
: "${KRILLINAI_TTS_MODEL:=tts-1}"
: "${KRILLINAI_TTS_PROVIDER_KEY:=}"

export KRILLINAI_SEGMENT_DURATION KRILLINAI_TRANSCRIBE_PARALLEL \
       KRILLINAI_TRANSLATE_PARALLEL KRILLINAI_PROXY \
       KRILLINAI_LLM_BASE_URL KRILLINAI_LLM_MODEL KRILLINAI_LLM_API_KEY \
       KRILLINAI_TRANSCRIBE_PROVIDER KRILLINAI_TRANSCRIBE_BASE_URL \
       KRILLINAI_TRANSCRIBE_MODEL KRILLINAI_TRANSCRIBE_API_KEY \
       KRILLINAI_TTS_PROVIDER KRILLINAI_TTS_BASE_URL KRILLINAI_TTS_MODEL \
       KRILLINAI_TTS_PROVIDER_KEY

# Warn rather than fail: the worker must still boot and report health when the
# provider keys are absent. Media jobs then fail individually with a clear
# error, instead of the whole container crash-looping and hiding the cause.
if [ -z "${KRILLINAI_LLM_API_KEY}" ]; then
  echo "entrypoint: WARNING KRILLINAI_LLM_API_KEY is empty — translation jobs will fail" >&2
fi
if [ -z "${KRILLINAI_TTS_PROVIDER_KEY}" ]; then
  echo "entrypoint: WARNING KRILLINAI_TTS_PROVIDER_KEY is empty — dubbing jobs will fail" >&2
fi

mkdir -p "$(dirname "${TARGET}")"

# Create the file with restrictive permissions BEFORE any secret reaches it —
# writing first and chmod-ing after leaves a window where it is world-readable.
umask 077

# Pass envsubst an explicit variable list. With no list it substitutes every
# ${...} it finds, which would mangle any future shell-style token in the
# template that is not meant to be interpolated.
envsubst '
  ${KRILLINAI_SEGMENT_DURATION}
  ${KRILLINAI_TRANSCRIBE_PARALLEL}
  ${KRILLINAI_TRANSLATE_PARALLEL}
  ${KRILLINAI_PROXY}
  ${KRILLINAI_LLM_BASE_URL}
  ${KRILLINAI_LLM_MODEL}
  ${KRILLINAI_LLM_API_KEY}
  ${KRILLINAI_TRANSCRIBE_PROVIDER}
  ${KRILLINAI_TRANSCRIBE_BASE_URL}
  ${KRILLINAI_TRANSCRIBE_MODEL}
  ${KRILLINAI_TRANSCRIBE_API_KEY}
  ${KRILLINAI_TTS_PROVIDER}
  ${KRILLINAI_TTS_BASE_URL}
  ${KRILLINAI_TTS_MODEL}
  ${KRILLINAI_TTS_PROVIDER_KEY}
' < "${TEMPLATE}" > "${TARGET}"

chmod 600 "${TARGET}"

echo "entrypoint: rendered ${TARGET} ($(wc -c < "${TARGET}") bytes, llm=${KRILLINAI_LLM_MODEL}, tts=${KRILLINAI_TTS_PROVIDER})"

# exec so the CMD becomes this PID and receives tini's forwarded SIGTERM
# directly. Without exec, the shell would stay PID 1's child and swallow it.
exec "$@"
