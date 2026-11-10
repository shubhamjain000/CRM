"""Celery tasks for the assignment_rules app.

* :func:`evaluate_assignment_rules` — dispatched by the ``post_save``
  signal on Lead / Contact / Account / Deal create. Resolves the user
  via :meth:`assignment_rules.services.AssignmentService.assign` and
  updates the record's ``owner``. The task is dispatched async (Celery
  ``.delay()``) so the request isn't blocked.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(
    bind=True,
    name="assignment_rules.evaluate_assignment_rules",
    max_retries=2,
    default_retry_delay=30,
)
def evaluate_assignment_rules(
    self: Any,
    *,
    tenant_id: int,
    record_module: str,
    record_id: int | str,
) -> dict[str, Any]:
    """Evaluate the assignment rules for ``record_module:record_id``.

    Binds the tenant via :func:`api.managers.tenant_context`, fetches the
    record, builds a record dict, and calls
    :meth:`assignment_rules.services.AssignmentService.assign`. The
    service updates the record's ``owner`` and logs an
    :class:`AssignmentHistory` row.

    Returns ``{"ok": bool, "user_id": int | None, "rule_id": int | None}``.
    """
    from api.managers import tenant_context
    from api.models import Organization
    from assignment_rules.services import AssignmentService

    tenant = Organization.objects.filter(pk=tenant_id).first()
    if tenant is None:
        log.warning(
            "evaluate_assignment_rules: tenant %s missing; aborting.", tenant_id
        )
        return {"ok": False, "reason": "tenant_missing"}

    with tenant_context(tenant):
        try:
            service = AssignmentService()
            record_data = _record_to_dict(record_module, record_id)
            if record_data is None:
                return {"ok": False, "reason": "record_not_found"}
            history = service.assign(
                record_module=record_module,
                record_id=record_id,
                record_data=record_data,
            )
        except Exception as exc:  # pragma: no cover — defensive
            log.exception(
                "evaluate_assignment_rules: failed for %s:%s",
                record_module, record_id,
            )
            try:
                raise self.retry(exc=exc, countdown=30)
            except self.MaxRetriesExceededError:  # type: ignore[attr-defined]
                return {"ok": False, "reason": str(exc)}
        if history is None:
            return {"ok": True, "user_id": None, "rule_id": None}
        return {
            "ok": True,
            "user_id": history.assigned_to_id,
            "rule_id": history.rule_id,
        }


def _record_to_dict(record_module: str, record_id: int | str) -> dict[str, Any] | None:
    """Fetch the record and project it into a flat dict of concrete-field values."""
    from assignment_rules.services import AssignmentService

    model_cls = AssignmentService._resolve_model(record_module)
    if model_cls is None:
        return None
    record = model_cls.objects.filter(pk=record_id).first()
    if record is None:
        return None
    out: dict[str, Any] = {}
    for field in record._meta.concrete_fields:  # type: ignore[attr-defined]
        try:
            out[field.name] = getattr(record, field.attname)
        except Exception:  # pragma: no cover — defensive
            continue
    return out


__all__ = ["evaluate_assignment_rules"]
