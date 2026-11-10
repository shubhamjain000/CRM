"""Celery tasks for the CRM UX app.

* :func:`cleanup_trash` — permanently delete CRM records soft-deleted more
  than ``retention_days`` ago. Scheduled daily at 02:00 UTC via Celery beat
  (see ``config/settings.py`` ``CELERY_BEAT_SCHEDULE`` entry
  ``crm-ux-cleanup-trash``).

The task iterates per-tenant via :func:`api.managers.tenant_context` so the
thread-local tenant scoping (and the audit-log writes inside
:func:`crm_ux.services.purge_from_trash`) are correct.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.utils import timezone

from api.managers import tenant_context
from api.models import Organization

from .services import ALL_MODULES, resolve_module_model

log = logging.getLogger(__name__)

#: Default retention for the beat-scheduled task. Override via task kwargs.
DEFAULT_RETENTION_DAYS = 30


@shared_task(name="crm_ux.cleanup_trash")
def cleanup_trash(retention_days: int = DEFAULT_RETENTION_DAYS) -> dict[str, Any]:
    """Permanently delete CRM records soft-deleted more than ``retention_days`` ago.

    Sweeps all four CRM modules across every active tenant. Returns a summary
    dict for the audit trail.
    """
    cutoff = timezone.now() - timedelta(days=retention_days)
    summary: dict[str, Any] = {
        "retention_days": retention_days,
        "cutoff": cutoff.isoformat(),
        "tenants_processed": 0,
        "purged_per_module": {module: 0 for module in ALL_MODULES},
    }

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            for module in ALL_MODULES:
                model = resolve_module_model(module)
                qs = model.all_objects.filter(
                    tenant=org,
                    deleted_at__isnull=False,
                    deleted_at__lt=cutoff,
                )
                if not qs.exists():
                    continue
                deleted, _ = qs.delete()
                summary["purged_per_module"][module] += deleted
                log.info(
                    "cleanup_trash: org=%s module=%s purged=%s",
                    org.slug, module, deleted,
                )

    log.info(
        "cleanup_trash: tenants_processed=%s purged=%s",
        summary["tenants_processed"], summary["purged_per_module"],
    )
    return summary
