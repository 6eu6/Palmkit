#!/bin/bash
# /opt/palmkit-worker/auto-pull.sh
# Auto-pull main branch and restart the worker if code changed.
# Runs every 2 minutes via systemd timer (palmkit-worker-autopull.timer).
#
# SAFE RESTART: before restarting, waits for all active jobs to finish.
# Checks /jobs/stats endpoint for pendingJobs count. If > 0, skips restart
# this cycle and tries again next time. This prevents killing active builds.

set -euo pipefail
LOG=/var/log/palmkit-autopull.log
TS() { date '+%Y-%m-%d %H:%M:%S'; }

cd /opt/palmkit-worker

# Ensure all branches are fetchable
git remote set-branches origin '*' 2>/dev/null || true

BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "none")

git fetch origin --tags --force >>"$LOG" 2>&1 || {
  echo "[$(TS)] ERROR: git fetch failed" >>"$LOG"
  exit 0
}

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  git checkout main >>"$LOG" 2>&1 || git checkout -B main origin/main >>"$LOG" 2>&1 || {
    echo "[$(TS)] ERROR: cannot switch to main" >>"$LOG"
    exit 0
  }
fi

git reset --hard origin/main >>"$LOG" 2>&1 || {
  echo "[$(TS)] ERROR: git reset failed" >>"$LOG"
  exit 0
}

AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  echo "[$(TS)] Code changed: $BEFORE -> $AFTER" >>"$LOG"

  # CHECK: are there active jobs? If so, DON'T restart — wait for next cycle.
  ACTIVE_JOBS=$(curl -s http://localhost:8787/jobs/stats 2>/dev/null | grep -o '"pendingJobs":[0-9]*' | grep -o '[0-9]*' || echo "0")
  
  if [ "$ACTIVE_JOBS" -gt 0 ]; then
    echo "[$(TS)] SKIP restart — $ACTIVE_JOBS active job(s) running. Will retry next cycle." >>"$LOG"
    exit 0
  fi

  echo "[$(TS)] No active jobs. Installing deps..." >>"$LOG"
  (
    cd /opt/palmkit-worker/external-worker
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    bun install --frozen-lockfile >>"$LOG" 2>&1 || {
      echo "[$(TS)] WARN: bun install failed (continuing with existing deps)" >>"$LOG"
    }
  )
  echo "[$(TS)] Restarting palmkit-worker service..." >>"$LOG"
  sudo systemctl restart palmkit-worker >>"$LOG" 2>&1 || {
    echo "[$(TS)] ERROR: systemctl restart failed" >>"$LOG"
    exit 0
  }
  echo "[$(TS)] Worker updated and restarted" >>"$LOG"
fi
