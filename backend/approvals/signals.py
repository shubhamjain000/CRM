"""Signal handlers for the approvals app.

Wired in :meth:`approvals.apps.ApprovalsConfig.ready`.

* On ``ApprovalRequest.post_save(created=True)`` we log a
  ``approval.submitted`` activity so the activity feed picks up the new
  request. The first-step approver notifications are dispatched by
  :meth:`approvals.services.ApprovalService.submit` (the signal is for
  the activity feed only).
* On ``ApprovalAction.post_save(created=True)`` we log a
  ``approval.{action}`` activity so the audit trail is mirrored in the
  feed. The submitter notification is dispatched by the service.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db.models.signals import post_save
from django.dispatch import receiver

from approvals.models import ApprovalAction, ApprovalRequest

log = logging.getLogger(__name__)


@receiver(post_save, sender=ApprovalRequest)
def approval_request_post_save(
    sender: type,
    instance: ApprovalRequest,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Log ``approval.submitted`` on creation (best-effort)."""
    if raw or not created or instance.tenant_id is None:
        return
    try:
        from crm_ux.services import log_activity

        log_activity(
            tenant=instance.tenant,
            actor=instance.submitted_by,
            verb="approval.submitted",
            target_module=instance.target_module,
            target_id=str(instance.target_id),
            target_name=instance.target_name,
            data={
                "request_id": instance.pk,
                "process_id": instance.process_id,
                "process_name": instance.process.name if instance.process_id else "",
            },
        )
    except Exception:  # pragma: no cover — defensive
        log.exception(
            "approval_request_post_save: failed to log activity for request %s",
            instance.pk,
        )


@receiver(post_save, sender=ApprovalAction)
def approval_action_post_save(
    sender: type,
    instance: ApprovalAction,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Log ``approval.{action}`` on creation (best-effort)."""
    if raw or not created or instance.tenant_id is None:
        return
    try:
        from crm_ux.services import log_activity

        request = instance.request
        log_activity(
            tenant=instance.tenant,
            actor=instance.approver,
            verb=f"approval.{instance.action}",
            target_module=request.target_module,
            target_id=str(request.target_id),
            target_name=request.target_name,
            data={
                "request_id": request.pk,
                "action_id": instance.pk,
                "comment": instance.comment,
            },
        )
    except Exception:  # pragma: no cover — defensive
        log.exception(
            "approval_action_post_save: failed to log activity for action %s",
            instance.pk,
        )


__all__ = ["approval_action_post_save", "approval_request_post_save"]
