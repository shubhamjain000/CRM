# Unstop CRM — Sales, Cadence & Success Platform

A production-ready CRM built for the Unstop Sales team workflow: lead-to-deal
pipelines, a repeatable **CSM follow-up cadence** (Day 0 → Day 1 → Day 3 → Day 7
→ Day 14), automatic follow-up tasks, live BI, and an AI assistant that can
actually do work.

> **Deploying?** See **[DEPLOY.md](./DEPLOY.md)** — Docker (recommended),
> Railway/Render, plain VPS, or LAN sharing in a few commands each.

## What's inside

| Area | Highlights |
| --- | --- |
| CRM | Leads, Contacts, Accounts, Deals · big sectioned forms · custom fields · import (CSV/Excel/Word/PDF/JSON) · export · saved views · trash |
| CSM cadence | 10-step **Next step** field (None → Day 0 → Day 0 reconnect → Day 1 Reconnect → Day 3 Call → Day 3 Reconnect → Day 7 → Day 14 Call → Old Lead → CSM Loop complete) · due dates stamped automatically · follow-up task auto-created · row/bulk/detail/form entry points |
| BI | **Analytics → CSM Cadence** (active loops, overdue, due today, call list, loop-completion rate, 14-day activity) · funnel, win/loss, velocity, source ROI, rep performance |
| Productivity | Tasks (CSM follow-ups land here automatically), Calendar, Calls, Today view |
| AI (Zia) | Chat that acts: create tasks, to-dos, calendar events, set a contact's next step |
| Platform | Multi-tenant orgs, roles, 2FA/passkeys, audit log, notes with cadence kinds, email/telephony/inbox, workflows, blueprints, reports |

## Quick start (local)

Requires [Bun](https://bun.sh) 1.2+ (Windows/macOS/Linux).

```bash
bun install
cp .env.example .env        # DATABASE_URL=file:./db/custom.db
mkdir -p db
bunx prisma db push         # create/refresh the SQLite schema
bun run dev                 # http://localhost:3000
```

Sign up on first launch — the first account owns its own organization.

### Production build (local check)

```bash
bun run build                                       # standalone output
DATABASE_URL=file:./db/custom.db bun .next/standalone/server.js
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server on port 3000 |
| `bun run build` | Production build (standalone) |
| `bun run lint` | ESLint |
| `bun run db:push` | Apply `prisma/schema.prisma` to the SQLite DB |
| `bun run db:generate` | Regenerate the Prisma client |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma +
SQLite · z-ai-web-dev-sdk (Zia AI) · socket.io (realtime) · Recharts/FullCalendar.
# CRM
