#!/usr/bin/env bash
# Background loop watchdog — runs dev-alive.sh every 45s forever.
# Keeps app (:3000), whatsapp-connector (:3010) and realtime (:3003) alive,
# and recycles next-server before its RSS wedges the 4GB sandbox box.
# Started detached via:  bash scripts/dev-watchdog.sh &
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/watchdog.log"
echo "[watchdog] started $(date)" >> "$LOG"
while true; do
  bash "$ROOT/scripts/dev-alive.sh" >> "$LOG" 2>&1 || true
  sleep 45
done
