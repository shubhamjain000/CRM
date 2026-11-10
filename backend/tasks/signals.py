"""Signal handlers for the tasks app.

Wired in :meth:`tasks.apps.TasksConfig.ready`.

Strategy
--------
Detecting an assignee change in ``post_save`` is tricky because the DB row
already reflects the new value by the time the signal fires. We therefore use
a ``pre_save`` + ``post_save`` pair:

* ``pre_save`` fetches the prior ``assignee_id`` from the DB (when the row
  already exists) and stashes it on the instance as ``_prior_assignee_id``.
* ``post_save`` compares ``instance._prior_assignee_id`` to
  ``instance.assignee_id``; if they differ, it logs a ``task.assigned``
  activity on the related CRM record.

Both handlers also log:

* ``task.created`` on initial create,
* ``task.deleted`` / ``task.restored`` on soft-delete / restore,
* ``task.last_activity`` stamped on initial create.
"""

from __future__ import annotations

from typing import Any

from django.db.models.base import ModelBase
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from tasks.models import Task


def _related_record_info(task: Task) -> tuple[str, str] | None:
    """Return ``(module, record_id)`` if this task is linked to a CRM record."""
    if task.related_module and task.related_id:
        return task.related_module, str(task.related_id)
    return None


def _log_task_activity(
    *,
    task: Task,
    action: str,
    description: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Best-effort write to the CRM activity log on the related record.

    Skips silently if the task isn't linked to a CRM record (most aren't) or
    if the tenant isn't set (system / fixture loads).
    """
    if task.tenant_id is None:
        return
    info = _related_record_info(task)
    if info is None:
        return
    module, record_id = info
    # Lazy import to avoid a circular dependency at module load time.
    from crm_ux.services import log_activity

    log_activity(
        tenant=task.tenant,
        user=task.created_by or task.owner,
        module=module,
        record_id=record_id,
        record_name=task.title,
        action=action,
        description=description,
        metadata=metadata or {"task_id": task.pk, "task_title": task.title},
    )


@receiver(pre_save, sender=Task)
def task_pre_save(
    sender: ModelBase,
    instance: Task,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Capture the prior ``assignee_id`` so post_save can detect changes."""
    if raw:
        return
    if instance.pk is None:
        instance._prior_assignee_id = None  # type: ignore[attr-defined]
        return
    try:
        prior = Task.all_objects.filter(pk=instance.pk).only("assignee_id").first()
    except Task.DoesNotExist:  # pragma: no cover — defensive
        prior = None
    instance._prior_assignee_id = prior.assignee_id if prior else None  # type: ignore[attr-defined]


@receiver(post_save, sender=Task)
def task_post_save(
    sender: ModelBase,
    instance: Task,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Auto-log task create / assignee-change / soft-delete / restore."""
    if raw:
        return
    if instance.tenant_id is None:
        return

    update_fields = kwargs.get("update_fields")

    if created:
        _log_task_activity(
            task=instance,
            action="task.created",
            description=f"Task '{instance.title}' created.",
        )
        # Stamp last_activity on initial create (idempotent — only if unset).
        if instance.last_activity is None:
            Task.all_objects.filter(pk=instance.pk).update(last_activity=timezone.now())
        return

    if update_fields and "deleted_at" in update_fields:
        if instance.deleted_at is not None:
            _log_task_activity(
                task=instance,
                action="task.deleted",
                description=f"Task '{instance.title}' deleted.",
            )
        else:
            _log_task_activity(
                task=instance,
                action="task.restored",
                description=f"Task '{instance.title}' restored.",
            )
        return

    # Assignee change → notification. Comparing the pre_save-captured prior
    # value to the current one.
    prior = getattr(instance, "_prior_assignee_id", None)
    if prior is not None and prior != instance.assignee_id:
        _log_task_activity(
            task=instance,
            action="task.assigned",
            description=f"Task '{instance.title}' assigned to user {instance.assignee_id}.",
            metadata={
                "task_id": instance.pk,
                "prior_assignee_id": prior,
                "new_assignee_id": instance.assignee_id,
            },
        )
