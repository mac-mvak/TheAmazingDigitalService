#!/usr/bin/env bash
#
# Container entrypoint. Brings up the self-hosted Convex backend, pushes the
# proxy functions into it, records the upstream worker address in the Convex
# database, then fronts both backend ports on Render's single public $PORT.
#
# The admin key is derived from INSTANCE_NAME/INSTANCE_SECRET inside the
# container and used only here, so it never needs to be stored or transported.
set -euo pipefail

APP_DIR=/convex/app
BACKEND_URL="http://127.0.0.1:3210"
: "${WORKER_URL:?WORKER_URL must be set to the upstream origin to proxy to}"

log() { echo "[bootstrap] $*"; }

cd /convex

log "starting convex backend"
./run_backend.sh &
BACKEND_PID=$!

log "waiting for backend at ${BACKEND_URL}/version"
for attempt in $(seq 1 180); do
  if curl -sf -o /dev/null "${BACKEND_URL}/version"; then
    log "backend is up after ${attempt}s"
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log "FATAL: backend exited during startup"
    wait "$BACKEND_PID"
    exit 1
  fi
  sleep 1
done

if ! curl -sf -o /dev/null "${BACKEND_URL}/version"; then
  log "FATAL: backend did not become healthy in time"
  exit 1
fi

ADMIN_KEY="$(./generate_admin_key.sh)"

cd "$APP_DIR"
export CONVEX_SELF_HOSTED_URL="$BACKEND_URL"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"
# Keep Convex's scratch space on the same filesystem as the app directory; the
# default /tmp is a different mount than the attached disk.
export CONVEX_TMPDIR="${APP_DIR}/.convex-tmp"
mkdir -p "$CONVEX_TMPDIR"

log "pushing convex functions"
./node_modules/.bin/convex deploy --typecheck disable

log "recording proxy target ${WORKER_URL} in the convex database"
TARGET_ARGS="$(node -e 'process.stdout.write(JSON.stringify({ url: process.argv[1] }))' "$WORKER_URL")"
./node_modules/.bin/convex run targets:upsert "$TARGET_ARGS"

log "starting front proxy on port ${PORT:-10000}"
node "${APP_DIR}/front-proxy.mjs" &
PROXY_PID=$!

# If either process dies the container is no longer serving correctly; exit so
# Render restarts it rather than lingering in a half-broken state.
set +e
wait -n "$BACKEND_PID" "$PROXY_PID"
EXIT_CODE=$?
log "a child process exited (code ${EXIT_CODE}); shutting down"
kill "$BACKEND_PID" "$PROXY_PID" 2>/dev/null
exit "${EXIT_CODE}"
