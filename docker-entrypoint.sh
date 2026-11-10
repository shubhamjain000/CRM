#!/bin/sh
set -e

echo "[entrypoint] applying Prisma schema (idempotent)…"
mkdir -p /app/db
bunx prisma db push --skip-generate

echo "[entrypoint] starting Unstop CRM on port ${PORT:-3000}…"
exec bun server.js
