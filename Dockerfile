# syntax=docker/dockerfile:1

# ---------- base ----------
FROM oven/bun:1.2-debian AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- dependencies ----------
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---------- build ----------
FROM base AS build
# Prisma engines need OpenSSL on Debian slim images
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `bun run build` = next build (output: standalone) + copies static/public into the bundle
RUN bunx prisma generate && bun run build

# ---------- runtime ----------
FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Standalone server (already includes .next/static + public via the build script)
COPY --from=build /app/.next/standalone ./
# Prisma CLI + generated client so the entrypoint can apply the schema on boot
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.bin ./node_modules/.bin
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/db

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
