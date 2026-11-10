"""Celery tasks for the workflows app.

* :func:`evaluate_workflow_rules` — dispatched by the
  :mod:`workflows.signals` post_save / post_delete handlers on Lead /
  Contact / Account / Deal. Resolves the record, calls
  :meth:`workflows.services.WorkflowService.evaluate_rules`.
* :func:`execute_workflow_task` — dispatched by ``evaluate_rules`` for each
  matching rule (and by ``test_run`` / ``rerun`` viewset actions). Wraps
  :meth:`workflows.services.WorkflowService.execute_workflow` with a
  3-attempt retry + exponential backoff.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(
    name="workflows.evaluate_workflow_rules",
    max_retries=2,
    default_retry_delay=15,
)
def evaluate_workflow_rules(
    *,
    tenant_id: int,
    trigger_type: str,
    trigger_model: str,
    record_id: int | str,
) -> dict[str, Any]:
    """Resolve the record + delegate to :meth:`WorkflowService.evaluate_rules`.

    Returns ``{"ok": bool, "enqueued": [rule_ids]}``.
    """
    from api.managers import tenant_context
    from api.models import Organization
    from workflows.services import WorkflowService, _resolve_model

    tenant = Organization.objects.filter(pk=tenant_id).first()
    if tenant is None:
        log.warning("evaluate_workflow_rules: tenant %s missing", tenant_id)
        return {"ok": False, "reason": "tenant_missing"}
    model_cls = _resolve_model(trigger_model)
    if model_cls is None:
        return {"ok": False, "reason": "unknown_module"}
    with tenant_context(tenant):
        record = model_cls.objects.filter(pk=record_id).first()
        if record is None:
            return {"ok": False, "reason": "record_not_found"}
        try:
            enqueued = WorkflowService().evaluate_rules(
                instance=record,
                trigger_type=trigger_type,
                trigger_model=trigger_model,
            )
        except Exception as exc:  # pragma: no cover — defensive
            log.exception(
                "evaluate_workflow_rules: failed for %s:%s",
                trigger_model, record_id,
            )
            return {"ok": False, "reason": str(exc)}
    return {"ok": True, "enqueued": enqueued}


@shared_task(
    bind=True,
    name="workflows.execute_workflow_task",
    max_retries=3,
    default_retry_delay=30,
)
def execute_workflow_task(
    self: Any,
    *,
    rule_id: int,
    target_module: str,
    target_id: str,
    from_order: int = 0,
) -> dict[str, Any]:
    """Execute a single workflow rule against ``target_module:target_id``.

    Wraps :meth:`WorkflowService.execute_workflow`. On failure, retries up
    to 3 times with exponential backoff (30s / 60s / 120s), then marks the
    execution failed + alerts tenant admins (the alert is handled inside
    the service).
    """
    from api.managers import tenant_context
    from api.models import Organization
    from workflows.models import WorkflowRule
    from workflows.services import WorkflowService

    rule = WorkflowRule.objects.filter(pk=rule_id).first()
    if rule is None:
        log.warning("execute_workflow_task: rule %s missing", rule_id)
        return {"ok": False, "reason": "rule_missing"}
    with tenant_context(rule.tenant):
        try:
            execution = WorkflowService().execute_workflow(
                rule_id=rule_id,
                target_module=target_module,
                target_id=target_id,
            )
        except Exception as exc:  # pragma: no cover — defensive
            log.exception(
                "execute_workflow_task: failed for rule %s on %s:%s",
                rule_id, target_module, target_id,
            )
            try:
                raise self.retry(exc=exc, countdown=30 * (2 ** self.request.retries))
            except self.MaxRetriesExceededError:  # type: ignore[attr-defined]
                return {"ok": False, "reason": str(exc), "rule_id": rule_id}
    return {
        "ok": execution.status == "completed",
        "execution_id": execution.pk,
        "status": execution.status,
        "rule_id": rule_id,
    }


__all__ = ["evaluate_workflow_rules", "execute_workflow_task"]
