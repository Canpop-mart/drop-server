#!/usr/bin/env bash
# test-game.sh — launch one Drop-installed Windows game via umu/Proton,
# observe it for $TIMEOUT_SECS, classify the outcome, and POST a result
# to drop-server's compat API.
#
# Phase A of the compatibility-testing feature: wraps the manual debug
# pattern we developed for STS2/F1 2021 into something repeatable. The
# heavy lifting (claiming work, marking installed/uninstalled) lands in
# Phase C inside drop-client; this script is the standalone shim that
# proves the API + DB plumbing works end-to-end.
#
# Required env:
#   DROP_SERVER       e.g. http://localhost:3000
#   CLIENT_ID         your client UUID (find in drop-client config)
#   CLIENT_JWT        a signed JWT for that client (re-export when it expires)
#   GAME_ID           Drop game id (UUID)
#
# Required positional args:
#   $1  prefix UUID under ~/.local/share/drop/pfx/
#   $2  path to the game's .exe
#   $3  AppID (or 0 if not Steam-sourced)
#
# Optional env:
#   TIMEOUT_SECS      observation window (default 45)
#   PROTONPATH        Proton install dir (default GE-Proton10-32)
#   NOTES             free-form note to attach to the result
#
# Exit code mirrors the outcome bucket — 0 only if status came back "alive_renders"
# (the user said yes to the "did you see the menu?" prompt).

set -u

# ---- arg parsing ---------------------------------------------------------
PFX_UUID="${1:?prefix uuid required}"
EXE_PATH="${2:?exe path required}"
APPID="${3:?appid required}"

: "${DROP_SERVER:?DROP_SERVER env var required (e.g. http://localhost:3000)}"
: "${CLIENT_ID:?CLIENT_ID env var required}"
: "${CLIENT_JWT:?CLIENT_JWT env var required}"
: "${GAME_ID:?GAME_ID env var required}"

TIMEOUT_SECS="${TIMEOUT_SECS:-45}"
PROTONPATH="${PROTONPATH:-/home/deck/.local/share/Steam/compatibilitytools.d/GE-Proton10-32}"
NOTES="${NOTES:-}"

PROTON_VERSION=$(basename "$PROTONPATH")
PFX="/home/deck/.local/share/drop/pfx/$PFX_UUID"
EXE_NAME=$(basename "$EXE_PATH")
LOG=$(mktemp /tmp/drop-compat-XXXXXX.log)

# ---- post helper ---------------------------------------------------------
post_result() {
  local status="$1"
  local signature="${2:-}"
  local log_excerpt
  log_excerpt=$(tail -c 16384 "$LOG" 2>/dev/null || true)

  jq -n \
    --arg gameId "$GAME_ID" \
    --arg status "$status" \
    --arg signature "$signature" \
    --arg protonVersion "$PROTON_VERSION" \
    --arg notes "$NOTES" \
    --arg logExcerpt "$log_excerpt" \
    '{gameId: $gameId, status: $status}
     + (if $signature == "" then {} else {signature: $signature} end)
     + (if $protonVersion == "" then {} else {protonVersion: $protonVersion} end)
     + (if $notes == "" then {} else {notes: $notes} end)
     + (if $logExcerpt == "" then {} else {logExcerpt: $logExcerpt} end)' \
    | curl -fsS \
        -X POST "$DROP_SERVER/api/v1/client/compat/results" \
        -H "Content-Type: application/json" \
        -H "Authorization: JWT $CLIENT_ID $CLIENT_JWT" \
        --data-binary @- \
    || echo "[warn] failed to POST result for $GAME_ID" >&2
}

# ---- liveness check ------------------------------------------------------
if [ ! -d "$PFX" ]; then
  echo "no_launch|prefix missing: $PFX"
  post_result no_launch "prefix missing: $PFX_UUID"
  exit 4
fi
if [ ! -f "$EXE_PATH" ]; then
  echo "no_launch|exe missing: $EXE_PATH"
  post_result no_launch "exe missing"
  exit 4
fi

# ---- cleanup any stragglers ---------------------------------------------
pkill -9 -f "$EXE_NAME" 2>/dev/null || true
"$PROTONPATH/files/bin/wineserver" -k 2>/dev/null || true
sleep 2

# ---- launch in background -----------------------------------------------
WINEPREFIX="$PFX" \
GAMEID="$APPID" \
PROTONPATH="$PROTONPATH" \
umu-run "$EXE_PATH" >"$LOG" 2>&1 &
LAUNCH_PID=$!

# ---- observe -------------------------------------------------------------
START=$(date +%s)
EVER_ALIVE=0
while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  [ "$ELAPSED" -ge "$TIMEOUT_SECS" ] && break

  if pgrep -f "$EXE_NAME" >/dev/null; then
    EVER_ALIVE=1
  fi
  sleep 3
done

# ---- classify ------------------------------------------------------------
STILL_ALIVE=0
pgrep -f "$EXE_NAME" >/dev/null && STILL_ALIVE=1

CRASH_ADDR=$(grep -oE "at address [0-9a-fA-F]+" "$LOG" 2>/dev/null | head -1 | sed 's/^at address //')

if [ "$STILL_ALIVE" = 1 ]; then
  STATUS=alive_no_render  # liveness confirmed; user must promote to alive_renders
elif [ -n "$CRASH_ADDR" ]; then
  STATUS=crash
elif [ "$EVER_ALIVE" = 1 ]; then
  STATUS=early_exit
else
  STATUS=no_launch
fi

# Auto-extract a useful signature
SIG=""
case "$STATUS" in
  crash)
    SIG="page fault $CRASH_ADDR"
    ;;
  early_exit|no_launch)
    # Last err: line, trimmed
    SIG=$(grep -E "^[0-9a-f]+:err:|Unhandled" "$LOG" 2>/dev/null | tail -1 | cut -c1-180)
    ;;
esac

# ---- prompt user (only if alive — they may want to promote to renders) --
if [ "$STATUS" = alive_no_render ] && [ -t 0 ]; then
  read -p "  Did you see the actual game menu/UI render? [y/N/s=skip]: " ANSWER < /dev/tty
  case "$ANSWER" in
    y|Y) STATUS=alive_renders ;;
    s|S) ;;  # leave as alive_no_render
    *)   ;;  # leave as alive_no_render
  esac
fi

# ---- post + cleanup ------------------------------------------------------
post_result "$STATUS" "$SIG"

pkill -9 -f "$EXE_NAME" 2>/dev/null || true
"$PROTONPATH/files/bin/wineserver" -k 2>/dev/null || true

echo "$STATUS|$ELAPSED|$SIG"
echo "Log preserved at: $LOG" >&2

case "$STATUS" in
  alive_renders) exit 0 ;;
  alive_no_render) exit 1 ;;
  crash) exit 2 ;;
  early_exit) exit 3 ;;
  no_launch|*) exit 4 ;;
esac
