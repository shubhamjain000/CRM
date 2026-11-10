# Changelog

All notable changes to this project are documented here. Releases are generated
automatically by [semantic-release](https://semantic-release.gitbook.io/) from
conventional commits.

## 0.1.0

### Added
- Phase 1: foundation & DevOps.
  - Monorepo structure (backend / frontend / mobile / infra / docs / scripts).
  - Turborepo orchestration + pnpm workspaces (JS) + uv (Python).
  - Docker Compose local dev stack (PostgreSQL 16, Redis 7, MinIO, MailHog,
    Meilisearch, Celery worker, Celery beat, Daphne).
  - GitHub Actions CI: lint, type check, unit tests, build verification,
    preview environments (Vercel + ephemeral K8s), Terraform plan.
  - ArgoCD GitOps deploy flow to staging/prod.
  - Terraform modules: VPC, RDS, ElastiCache, S3, CloudFront, EKS.
  - Pre-commit hooks: ruff, black, eslint, prettier, mypy, tsc, conventional
    commits. semantic-release for versioning.
  - Django + Next.js app skeletons with health checks.
  - Frontend foundation dashboard with live `/api/health` polling.
