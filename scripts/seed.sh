#!/usr/bin/env bash
# Seed the local database with baseline data.
set -euo pipefail

echo "==> Running Django migrations..."
docker compose exec backend python manage.py migrate --noinput

echo "==> Seeding baseline data..."
docker compose exec backend python manage.py seed

echo "==> Rebuilding Meilisearch index..."
docker compose exec backend python manage.py meili_reindex

echo "==> Done."
