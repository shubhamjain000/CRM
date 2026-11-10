#!/usr/bin/env bash
# Build parker — keeps the dev server OUT of the way while `next build` runs.
#
# The deploy pipeline runs `next build` on this 4GB box. The dev server holds
# ~2.4GB; the build needs ~2.5-3GB. Together they OOM (kernel logs at
# 14:32/14:52 killed the build → empty staging dirs → "problem deploying").
# This loop reacts within 5s of a build starting, parks the dev server for
# the duration, and resumes it afterwards.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLAG="$ROOT/.dev-parked-by-build"

build_running() { pgrep -f "next build" > /dev/null 2>&1 || pgrep -f "bun run build" > /dev/null 2>&1; }
dev_running()   { pgrep -f "next-server" > /dev/null 2>&1 || pgrep -f "next dev" > /dev/null 2>&1; }

echo "[build-parker] started $(date)" >> "$ROOT/watchdog.log"
while true; do
  if build_running; then
    if dev_running; then
      echo "[build-parker] $(date +%H:%M:%S) build detected — parking dev server" >> "$ROOT/watchdog.log"
      pkill -f "next dev" 2>/dev/null
      pkill -f "next-server" 2>/dev/null
      # Make sure the processes are really gone before the build needs RAM.
      for _ in $(seq 1 15); do
        dev_running || break
        sleep 1
      done
      dev_running && { pkill -9 -f "next-server" 2>/dev/null; pkill -9 -f "next dev" 2>/dev/null; sleep 1; }
      date +%s > "$FLAG"
      date +%s > "$ROOT/.dev-restart-at"
    fi
  else
    # Build finished (or none running) — resume the dev server if WE parked it.
    if [ -f "$FLAG" ] && ! dev_running; then
      rm -f "$FLAG"
      echo "[build-parker] $(date +%H:%M:%S) build finished — resuming dev server" >> "$ROOT/watchdog.log"
      cd "$ROOT"
      NODE_OPTIONS="--max-old-space-size=2560" setsid nohup bun run dev > dev.log 2>&1 < /dev/null &
      date +%s > "$ROOT/.dev-restart-at"
    elif [ -f "$FLAG" ] && dev_running; then
      rm -f "$FLAG"
    fi
  fi
  sleep 5
done
