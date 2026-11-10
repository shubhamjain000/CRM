#!/usr/bin/env bash
# Convenience wrapper around `docker compose` dev commands.
set -euo pipefail

case "${1:-}" in
  up)    docker compose up -d ;;
  down)  docker compose down ;;
  logs)  docker compose logs -f --tail=100 ;;
  reset) docker compose down -v ;;
  *)
    echo "Usage: scripts/dev.sh {up|down|logs|reset}"
    exit 1
    ;;
esac
