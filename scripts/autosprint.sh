#!/usr/bin/env bash
set -euo pipefail

WORKDIR="$(cd "$(dirname "$0")" && pwd)"
LOGDIR="$WORKDIR/.autosprint-logs"
INTERVAL=600 # 10 minutes

mkdir -p "$LOGDIR"

PROMPT='Grab the next task from bd ready, implement and test it, then close the bd task and commit and merge it.'

while true; do
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  LOGFILE="$LOGDIR/$TIMESTAMP.log"

  echo "[$TIMESTAMP] Starting agent run..." | tee "$LOGFILE"

  agent -p --yolo --model sonnet-4-thinking "$PROMPT" 2>&1 | tee -a "$LOGFILE" || true

  echo "[$(date +%Y%m%d-%H%M%S)] Agent run finished. Log: $LOGFILE"
  echo "Sleeping ${INTERVAL}s until next run..."
  sleep "$INTERVAL"
done
