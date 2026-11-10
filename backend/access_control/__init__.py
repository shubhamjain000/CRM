"""access_control app — IP allowlist + session policy + trusted devices
(Phase 20).

Three tenant-scoped models:

* :class:`IPAllowlist` — CIDR allowlist entries with active flag.
* :class:`SessionPolicy` — one-per-tenant session timeout + concurrency
  cap (unique constraint on ``tenant``).
* :class:`TrustedDevice` — per-user trusted device registry.
"""
