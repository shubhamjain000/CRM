#!/usr/bin/env bash
# Ensure the Next.js dev server on :3000 is alive — restart if needed.
# Also guards mini-services: whatsapp-connector (:3010), realtime (:3003).
# Safe to run at the start of any command block (and from dev-watchdog.sh loop).
#
# Hardening notes (WhatsApp "service unreachable" incident):
# - next-server idles at ~2.5GB RSS on this 4GB box (Turbopack compiling the
#   large single-page dashboard). The wedge zone starts around 2.9-3GB, so the
#   memory guard recycles at 2.9GB — well above boot baseline, below the wedge.
# - Restarts are debounced: a single failed 5s check during a compile burst
#   does NOT trigger a restart; two consecutive failures do.
# - After (re)boot the WA proxy chain + core APIs are warmed up so the first
#   user visit never lands on a cold compile.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAX_RSS_KB=2750000   # ~2.75GB (baseline ≈2.5GB; kernel OOM needs total pressure, churn now fixed)
# NOTE: do NOT lower --max-old-space-size below 2560 — Next derives
# turbopackMemoryLimit = 75% of it, and a 1536MB Turbopack limit makes the
# process ABORT SILENTLY while compiling the large dashboard (boot-die loop,
# verified 2025-11-02).

ensure_service() { # $1 name  $2 port  $3 dir  $4 health-path
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:$2$4" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "$1:alive"
    return 0
  fi
  echo "$1:down (last code $code) — restarting…"
  cd "$ROOT/$3" || return 1
  setsid nohup bun run dev >> "$ROOT/$3/service.log" 2>&1 < /dev/null &
  cd "$ROOT"
  for _ in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:$2$4" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then echo "$1:up"; return 0; fi
    sleep 1
  done
  echo "$1:FAILED"
  return 1
}

# Wait until every previous next dev / next-server process has exited, so the
# new instance never races the old one for port 3000 (races caused silent
# boot failures and restart storms).
wait_dev_gone() {
  for _ in $(seq 1 15); do
    pgrep -f "next-server" > /dev/null 2>&1 || return 0
    sleep 1
  done
  pkill -9 -f "next-server" 2>/dev/null
  pkill -9 -f "next dev" 2>/dev/null
  sleep 1
}

start_dev() {
  # Never start the dev server while a production build is running — the
  # two together exceed the 4GB box and the build gets OOM-killed (the
  # deploy-pipeline failure). The build-parker resumes the server later.
  if pgrep -f "next build" > /dev/null 2>&1 || pgrep -f "bun run build" > /dev/null 2>&1; then
    echo "dev:start skipped — production build in progress (dev resumes after)"
    return 0
  fi
  cd "$ROOT"
  NODE_OPTIONS="--max-old-space-size=2560" setsid nohup bun run dev > dev.log 2>&1 < /dev/null &
  echo "$(date +%s)" > "$ROOT/.dev-restart-at"
}

# Warm the routes users hit first — prevents the "cold compile storm" that
# made the freshly restarted app look unreachable for the first minute.
warm_dev() {
  curl -s -o /dev/null --max-time 30  http://localhost:3000/ 2>/dev/null || true
  curl -s -o /dev/null --max-time 20  "http://localhost:3000/api/whatsapp/live/wa/status" 2>/dev/null || true
  curl -s -o /dev/null --max-time 20  "http://localhost:3000/api/health" 2>/dev/null || true
  curl -s -o /dev/null --max-time 20  "http://localhost:3000/api/notifications" 2>/dev/null || true
}

# Proactive memory guard — recycle next-server before it wedges the box.
recycle_next_server() {
  echo "memory-guard:recycling next-server…"
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  wait_dev_gone
  start_dev
  for _ in $(seq 1 90); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then echo "memory-guard:recovered"; warm_dev; return 0; fi
    sleep 1
  done
  echo "memory-guard:FAILED"
  return 1
}

# Kill every process whose CWD is the given service directory. Mini-services
# all run `bun --hot index.ts` with IDENTICAL command lines, so pkill -f
# cannot tell them apart — match on /proc/<pid>/cwd instead.
kill_service_cwd() { # $1 = service dir (absolute)
  local p pid cwd
  for pid in $(pgrep -f "bun --hot index.ts" 2>/dev/null; pgrep -f "bun run dev" 2>/dev/null); do
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
    [ "$cwd" = "$1" ] && kill -9 "$pid" 2>/dev/null
  done
  return 0
}

# Recycle ONLY the whatsapp-connector (cheap, website untouched). The
# connector holds a persisted WhatsApp session (./auth-state), so after a
# restart baileys auto-reconnects WITHOUT a QR re-scan — the user sees a few
# seconds of WhatsApp downtime and nothing else. This lets the guard shed the
# single largest secondary memory consumer (baileys history sync can balloon
# to 600MB) without ever bouncing the website.
recycle_connector() {
  echo "memory-guard:recycling whatsapp-connector (cheap recycle, website untouched)…"
  kill_service_cwd "$ROOT/mini-services/whatsapp-connector"
  sleep 1
  (cd "$ROOT/mini-services/whatsapp-connector" && setsid nohup bun run dev >> service.log 2>&1 < /dev/null &)
  for _ in $(seq 1 20); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3010/health 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then echo "memory-guard:connector recycled (WhatsApp auto-reconnects from saved session)"; return 0; fi
    sleep 1
  done
  echo "memory-guard:connector recycle FAILED (ensure_service will retry)"
  return 1
}

memory_guard() {
  local pid rss now last_restart
  # Two cooldowns:
  #   - 60s  for the hard RSS-cap recycle (next-server is wedging — must act)
  #   - 180s for the soft low-available-memory recycle (a freshly booted
  #     server ramps RSS while compiling; recycling during that ramp caused
  #     the restart storms users read as "the server keeps crashing").
  local now_sec=0
  if [ -f "$ROOT/.dev-restart-at" ]; then
    now_sec=$(date +%s); last_restart=$(cat "$ROOT/.dev-restart-at" 2>/dev/null || echo 0)
  fi
  pid=$(pgrep -f "next-server" | head -1)
  [ -z "$pid" ] && return 0
  rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -z "$rss" ] && return 0
  if [ "$rss" -gt "$MAX_RSS_KB" ]; then
    if [ $((now_sec - last_restart)) -lt 60 ]; then
      echo "memory-guard:RSS ${rss}KB high but server restarted <60s ago — cooldown"
      return 0
    fi
    echo "memory-guard:next-server RSS ${rss}KB > ${MAX_RSS_KB}KB — recycling…"
    recycle_next_server
    return 0
  fi
  # System-pressure guard (two-stage): the kernel OOM-killer picks the biggest
  # process (next-server, ~2.5GB) whenever combined load exhausts the box —
  # that is the "Failed to fetch" / "server crashes" users saw mid-session.
  # When available memory stays critically low across TWO consecutive ticks
  # (5s apart):
  #   Stage 1 — recycle the whatsapp-connector (up to ~600MB, cheap, no QR
  #             re-scan, website untouched) and give it 15s to settle.
  #   Stage 2 — only if the box is STILL starved, recycle next-server, and
  #             only after a 180s post-restart cooldown.
  local avail
  avail=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')
  [ -z "$avail" ] && return 0
  if [ "$avail" -lt 300 ]; then
    if [ -f "$ROOT/.low-mem-since" ]; then
      rm -f "$ROOT/.low-mem-since"
      if [ $((now_sec - last_restart)) -lt 180 ]; then
        echo "memory-guard:low memory (${avail}MB) but server restarted <180s ago — cooling down (connector will absorb pressure)"
        recycle_connector || true
        return 0
      fi
      echo "memory-guard:low available memory (${avail}MB) persisted — stage 1: recycle connector first"
      recycle_connector || true
      sleep 15
      avail=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')
      if [ -n "$avail" ] && [ "$avail" -lt 300 ]; then
        echo "memory-guard:still starved (${avail}MB) after connector recycle — stage 2: recycling next-server"
        recycle_next_server
      else
        echo "memory-guard:recovered after connector recycle (avail ${avail:-?}MB) — website stayed up"
      fi
    else
      date +%s > "$ROOT/.low-mem-since"
      echo "memory-guard:low available memory (${avail}MB) — will act if it persists 5s"
    fi
  else
    rm -f "$ROOT/.low-mem-since" 2>/dev/null
  fi
  return 0
}

# Mini-services first (app proxy depends on them)
ensure_service "wp-connector" 3010 "mini-services/whatsapp-connector" "/health" || true
ensure_service "realtime"     3003 "mini-services/realtime"          "/health" || true

# Self-reviving watchdog: if the background loop died (e.g. OOM-killed during
# a memory spike), relaunch it. The loop is what keeps services alive between
# agent commands.
if ! pgrep -f "scripts/dev-watchdog.sh" > /dev/null 2>&1; then
  echo "watchdog:relaunching background loop…"
  setsid nohup bash "$ROOT/scripts/dev-watchdog.sh" < /dev/null > /dev/null 2>&1 &
fi

# Self-reviving build-parker: parks the dev server within 5s of a `next build`
# starting and resumes it when the build ends (deploy OOM fix).
if ! pgrep -f "scripts/dev-build-parker.sh" > /dev/null 2>&1; then
  echo "build-parker:relaunching…"
  setsid nohup bash "$ROOT/scripts/dev-build-parker.sh" < /dev/null > /dev/null 2>&1 &
fi

# Recycle a bloated dev server even if it still answers (it wedges soon after).
memory_guard || true

# ---------------------------------------------------------------------------
# Build-parking (deploy OOM fix)
# ---------------------------------------------------------------------------
# `next build` for this app needs ~2.5-3GB. Running it next to the dev server
# (2.4GB resident) exceeds the 4GB sandbox and the kernel OOM-kills one of
# them — the 14:32 / 14:52 deploy failures were exactly this (build killed,
# empty staging dir, "problem while deploying"). While a production build is
# running we PARK the dev server so the build gets the whole box, and the
# next tick (45s later) resumes it automatically.
if pgrep -f "next build" > /dev/null 2>&1 || pgrep -f "bun run build" > /dev/null 2>&1; then
  if pgrep -f "next-server" > /dev/null 2>&1 || pgrep -f "next dev" > /dev/null 2>&1; then
    echo "build-mode:next build detected — parking the dev server to free memory"
    pkill -f "next dev" 2>/dev/null
    pkill -f "next-server" 2>/dev/null
    wait_dev_gone
    date +%s > "$ROOT/.dev-restart-at"
  else
    echo "build-mode:dev parked — waiting for the build to finish"
  fi
  exit 0
fi

# Steady-state health check, debounced: only restart after TWO consecutive
# failures (5s timeout each) — a lone timeout during a compile burst is normal.
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then
  echo "dev:alive"
  exit 0
fi
code2=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null || echo 000)
if [ "$code2" = "200" ]; then
  echo "dev:alive (slow check)"
  exit 0
fi
echo "dev:down (codes $code/$code2) — restarting…"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
wait_dev_gone
start_dev
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "dev:up after ${i}s"
    warm_dev
    exit 0
  fi
  sleep 1
done
echo "dev:FAILED"
tail -5 dev.log
exit 1
