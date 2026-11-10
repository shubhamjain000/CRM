"""Signal handlers for the calls app.

Wired in :meth:`calls.apps.CallsConfig.ready`.

``post_save`` on :class:`calls.models.Call`:

* On create: if the call has a related CRM record (``related_module`` +
  ``related_id`` set), log a ``called`` activity on that record so it shows
  up on the timeline.
* On update of ``deleted_at``: log ``call.deleted`` / ``call.restored`` on
  the related record (best-effort).
"""

from __future__ import annotations

from typing import Any

from django.db.models.base import ModelBase
from django.db.models.signals import post_save
from django.dispatch import receiver

from calls.models import Call


def _related_record_info(call: Call) -> tuple[str, str] | None:
    """Return ``(module, record_id)`` if this call is linked to a CRM record."""
    if call.related_module and call.related_id:
        return call.related_module, str(call.related_id)
    return None


def _log_call_activity(
    *,
    call: Call,
    action: str,
    description: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Best-effort write to the CRM activity log on the related record."""
    if call.tenant_id is None:
        return
    info = _related_record_info(call)
    if info is None:
        return
    module, record_id = info
    from crm_ux.services import log_activity

    log_activity(
        tenant=call.tenant,
        user=call.created_by,
        module=module,
        record_id=record_id,
        record_name=call.subject,
        action=action,
        description=description,
        metadata=metadata or {
            "call_id": call.pk,
            "call_type": call.call_type,
            "outcome": call.outcome,
            "duration": call.duration,
        },
    )


@receiver(post_save, sender=Call)
def call_post_save(
    sender: ModelBase,
    instance: Call,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Auto-log ``called`` on create and ``call.deleted`` / ``call.restored``."""
    if raw:
        return
    if instance.tenant_id is None:
        return

    update_fields = kwargs.get("update_fields")

    if created:
        _log_call_activity(
            call=instance,
            action="called",
            description=(
                f"{instance.call_type} call logged: '{instance.subject}' "
                f"({instance.duration}s, outcome={instance.outcome})."
            ),
        )
        return

    if update_fields and "deleted_at" in update_fields:
        if instance.deleted_at is not None:
            _log_call_activity(
                call=instance,
                action="call.deleted",
                description=f"Call '{instance.subject}' deleted.",
            )
        else:
            _log_call_activity(
                call=instance,
                action="call.restored",
                description=f"Call '{instance.subject}' restored.",
            )
