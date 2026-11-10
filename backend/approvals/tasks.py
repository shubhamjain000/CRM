"""Celery tasks for the approvals app.

One beat-scheduled task (see ``config/settings.py``):

* :func:`escalate_expired` — hourly. Wraps
  :meth:`approvals.services.ApprovalService.escalate_expired` so the
  escalation sweep runs on a worker rather than on the request path.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="approvals.escalate_expired")
def escalate_expired() -> dict[str, Any]:
    """Hourly Celery beat — escalate every pending request past its step's time limit.

    Delegates to :meth:`approvals.services.ApprovalService.escalate_expired`.
    The service iterates every active tenant via the thread-local
    ``tenant_context`` so RLS / audit logs are scoped correctly. Failures
    are caught + logged inside the service so the beat task never re-raises
    into the worker.
    """
    from api.managers import tenant_context
    from api.models import Organization
    from approvals.services import ApprovalService

    summary: dict[str, Any] = {"tenants": 0, "checked": 0, "escalated": 0, "errors": 0}
    service = ApprovalService()
    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            try:
                result = service.escalate_expired()
            except Exception as exc:  # pragma: no cover — defensive
                log.exception("approvals.escalate_expired: tenant %s failed", org.pk)
                summary["errors"] += 1
                summary["tenants"] += 1
                continue
            summary["tenants"] += 1
            summary["checked"] += int(result.get("checked", 0))
            summary["escalated"] += int(result.get("escalated", 0))
            summary["errors"] += int(result.get("errors", 0))
    log.info(
        "approvals.escalate_expired: tenants=%s checked=%s escalated=%s errors=%s",
        summary["tenants"],
        summary["checked"],
        summary["escalated"],
        summary["errors"],
    )
    return summary


__all__ = ["escalate_expired"]
