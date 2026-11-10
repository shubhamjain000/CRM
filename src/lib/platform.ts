/**
 * Central source of truth for the Platform Foundation metadata.
 * Later phases extend this manifest as new capabilities come online.
 */

export type WorkspaceStatus = 'live' | 'scaffold' | 'planned'

export interface Workspace {
  id: string
  name: string
  path: string
  stack: string
  status: WorkspaceStatus
  description: string
}

export interface DevService {
  id: string
  name: string
  image: string
  port: string
  purpose: string
  liveInSandbox: boolean
}

export interface PipelineStage {
  id: string
  name: string
  tooling: string
  detail: string
}

export interface RoadmapPhase {
  id: number
  title: string
  status: 'active' | 'pending' | 'done'
  summary: string
}

export const PLATFORM = {
  name: 'Foundation',
  version: '0.1.0',
  phase: 1,
  totalPhases: 20,
  environment: process.env.NODE_ENV ?? 'development',
} as const

export const WORKSPACES: Workspace[] = [
  {
    id: 'frontend',
    name: 'Frontend',
    path: '/frontend  (live in sandbox: /src)',
    stack: 'Next.js 16 · TypeScript · Tailwind 4 · shadcn/ui',
    status: 'live',
    description:
      'The visible application. This sandbox runs the frontend on port 3000. Health-check dashboard + foundation UI live now.',
  },
  {
    id: 'backend',
    name: 'Backend',
    path: '/backend',
    stack: 'Django · DRF · Celery · Channels (Daphne)',
    status: 'scaffold',
    description:
      'Django service skeleton with health endpoint, settings split, and async worker hooks. Runs via docker-compose outside the sandbox.',
  },
  {
    id: 'mobile',
    name: 'Mobile',
    path: '/mobile',
    stack: 'React Native · Expo',
    status: 'scaffold',
    description:
      'Expo app shell with navigation scaffold and shared design tokens. Bootstrapped for later phases.',
  },
  {
    id: 'infra',
    name: 'Infra',
    path: '/infra',
    stack: 'Terraform · AWS (VPC, RDS, ElastiCache, S3, CloudFront, EKS)',
    status: 'scaffold',
    description:
      'Reusable Terraform modules per concern. Remote state ready. Apply happens in CI, not in this sandbox.',
  },
  {
    id: 'docs',
    name: 'Docs',
    path: '/docs',
    stack: 'Mintlify',
    status: 'scaffold',
    description:
      'Product documentation portal. Navigation + landing scaffolded; content grows each phase.',
  },
  {
    id: 'scripts',
    name: 'Scripts',
    path: '/scripts',
    stack: 'Shell · Node',
    status: 'scaffold',
    description:
      'Utility scripts: local bootstrap, seed, backup, and release helpers.',
  },
]

export const DEV_SERVICES: DevService[] = [
  { id: 'postgres', name: 'PostgreSQL', image: 'postgres:16', port: '5432', purpose: 'Primary datastore', liveInSandbox: false },
  { id: 'redis', name: 'Redis', image: 'redis:7', port: '6379', purpose: 'Cache + Celery broker', liveInSandbox: false },
  { id: 'minio', name: 'MinIO', image: 'minio/minio', port: '9000/9001', purpose: 'S3-compatible object store', liveInSandbox: false },
  { id: 'mailhog', name: 'MailHog', image: 'mailhog/mailhog', port: '1025/8025', purpose: 'Local email capture', liveInSandbox: false },
  { id: 'meilisearch', name: 'Meilisearch', image: 'getmeili/meilisearch', port: '7700', purpose: 'Full-text search', liveInSandbox: false },
  { id: 'celery', name: 'Celery Worker', image: 'backend', port: '—', purpose: 'Async job runner', liveInSandbox: false },
  { id: 'celery-beat', name: 'Celery Beat', image: 'backend', port: '—', purpose: 'Scheduled tasks', liveInSandbox: false },
  { id: 'daphne', name: 'Daphne (WS)', image: 'backend', port: '8000', purpose: 'WebSocket / ASGI server', liveInSandbox: false },
]

export const PIPELINE: PipelineStage[] = [
  { id: 'lint', name: 'Lint', tooling: 'ruff · eslint · prettier', detail: 'Pre-commit + CI' },
  { id: 'types', name: 'Type Check', tooling: 'mypy · tsc', detail: 'Strict, zero errors' },
  { id: 'test', name: 'Unit Tests', tooling: 'pytest · vitest', detail: 'On every PR' },
  { id: 'build', name: 'Build', tooling: 'next build · django check', detail: 'Build verification' },
  { id: 'preview', name: 'Preview', tooling: 'Vercel · ephemeral K8s', detail: 'Per-PR environment' },
  { id: 'deploy', name: 'Deploy', tooling: 'ArgoCD GitOps', detail: 'staging → prod' },
]

export const ROADMAP: RoadmapPhase[] = [
  { id: 1, title: 'Foundation & DevOps', status: 'active', summary: 'Monorepo structure, Docker dev stack, CI/CD, Terraform modules, health checks.' },
  { id: 2, title: 'Auth & Identity', status: 'pending', summary: 'NextAuth + Django session/JWT, RBAC, org/workspace model.' },
  { id: 3, title: 'Data Layer', status: 'pending', summary: 'Prisma + Django models, migrations, audit trail.' },
  { id: 4, title: 'Realtime', status: 'pending', summary: 'Daphne + socket.io gateway, presence, channels.' },
  { id: 5, title: 'Search', status: 'pending', summary: 'Meilisearch indexing, faceted search UI.' },
  { id: 6, title: 'File Storage', status: 'pending', summary: 'MinIO/S3 uploads, signed URLs, image pipeline.' },
  { id: 7, title: 'Notifications', status: 'pending', summary: 'Email (MailHog/SES), in-app, push.' },
  { id: 8, title: 'Admin & Dashboard', status: 'pending', summary: 'Django admin + Next analytics dashboard.' },
  { id: 9, title: 'Mobile Shell', status: 'pending', summary: 'Expo navigation, auth, offline cache.' },
  { id: 10, title: 'Billing', status: 'pending', summary: 'Plans, usage metering, webhooks.' },
  { id: 11, title: 'AI Skills', status: 'pending', summary: 'LLM/VLM/TTS/ASR via z-ai-web-dev-sdk.' },
  { id: 12, title: 'Webhooks & Integrations', status: 'pending', summary: 'Outbound events, third-party connectors.' },
  { id: 13, title: 'Observability', status: 'pending', summary: 'Tracing, metrics, structured logs.' },
  { id: 14, title: 'Feature Flags', status: 'pending', summary: 'Gradual rollout, A/B.' },
  { id: 15, title: 'i18n', status: 'pending', summary: 'next-intl + Django i18n parity.' },
  { id: 16, title: 'Performance', status: 'pending', summary: 'Edge cache, query tuning, RSC audit.' },
  { id: 17, title: 'Security Hardening', status: 'pending', summary: 'Audit, rate limit, CSP, secrets scan.' },
  { id: 18, title: 'Accessibility', status: 'pending', summary: 'WCAG AA pass across flows.' },
  { id: 19, title: 'Load & Soak', status: 'pending', summary: 'k6 load profile, soak, fix regressions.' },
  { id: 20, title: 'Launch', status: 'pending', summary: 'Docs, runbooks, prod cutover, retro.' },
]
