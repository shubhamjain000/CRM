#!/usr/bin/env bash
# Bootstrap the local development environment (one-time).
set -euo pipefail

echo "==> Installing pre-commit hooks..."
pre-commit install --install-hooks
pre-commit install --hook-type commit-msg

echo "==> Copying backend env example..."
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "    created backend/.env"
else
  echo "    backend/.env already exists, skipping"
fi

echo "==> Ensuring local services data dirs exist..."
mkdir -p .data

echo "==> Bootstrap complete. Next: 'make dev'"
