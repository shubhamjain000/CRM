"""Celery tasks for the escalation_rules app.

One beat-scheduled task (see ``config/settings.py``):

* :func:`run_escalation_check` — every 15 minutes. Wraps
  :meth:`escalation_rules.services.EscalationService.check_escalations`
  so the sweep runs on a worker rather than on the request path.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="escalation_rules.run_escalation_check")
def run_escalation_check() -> dict[str, Any]:
    """Every-15-min Celery beat — escalate every record past an SLA.

    Delegates to
    :meth:`escalation_rules.services.EscalationService.check_escalations`.
    The service iterates every active tenant via the thread-local
    ``tenant_context`` so RLS / audit logs are scoped correctly. Failures
    are caught + logged inside the service so the beat task never re-raises
    into the worker.
    """
    from api.managers import tenant_context
    from api.models import Organization
    from escalation_rules.services import EscalationService

    summary: dict[str, Any] = {
        "tenants": 0,
        "checked": 0,
        "escalated": 0,
        "errors": 0,
    }
    service = EscalationService()
    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            try:
                result = service.check_escalations()
            except Exception as exc:  # pragma: no cover — defensive
                log.exception("run_escalation_check: tenant %s failed", org.pk)
                summary["tenants"] += 1
                summary["errors"] += 1
                continue
            summary["tenants"] += 1
            summary["checked"] += int(result.get("checked", 0))
            summary["escalated"] += int(result.get("escalated", 0))
            summary["errors"] += int(result.get("errors", 0))
    log.info(
        "run_escalation_check: tenants=%s checked=%s escalated=%s errors=%s",
        summary["tenants"],
        summary["checked"],
        summary["escalated"],
        summary["errors"],
    )
    return summary


__all__ = ["run_escalation_check"]
