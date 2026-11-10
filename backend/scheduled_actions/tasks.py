"""Celery tasks for the scheduled_actions app.

* :func:`run_scheduled_jobs` — beat-scheduled every 1 minute (see
  ``config/settings.py`` CELERY_BEAT_SCHEDULE). Wraps
  :meth:`scheduled_actions.services.ScheduledActionsService.run_due_jobs`
  so the sweep runs on a worker per-tenant.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="scheduled_actions.run_scheduled_jobs")
def run_scheduled_jobs() -> dict[str, Any]:
    """Every-1-min Celery beat — run every active job whose ``next_run_at`` is due.

    Iterates every active tenant via the thread-local ``tenant_context``
    so RLS / audit logs are scoped correctly. Failures are caught + logged
    inside the service so the beat task never re-raises into the worker.
    """
    from api.managers import tenant_context
    from api.models import Organization
    from scheduled_actions.services import ScheduledActionsService

    summary: dict[str, Any] = {
        "tenants": 0,
        "checked": 0,
        "ran": 0,
        "failed": 0,
    }
    service = ScheduledActionsService()
    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            try:
                result = service.run_due_jobs()
            except Exception:  # pragma: no cover — defensive
                log.exception("run_scheduled_jobs: tenant %s failed", org.pk)
                summary["tenants"] += 1
                continue
            summary["tenants"] += 1
            summary["checked"] += int(result.get("checked", 0))
            summary["ran"] += int(result.get("ran", 0))
            summary["failed"] += int(result.get("failed", 0))
    log.info(
        "run_scheduled_jobs: tenants=%s checked=%s ran=%s failed=%s",
        summary["tenants"], summary["checked"], summary["ran"], summary["failed"],
    )
    return summary


__all__ = ["run_scheduled_jobs"]
