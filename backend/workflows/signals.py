"""Signal handlers for the workflows app.

Wired in :meth:`workflows.apps.WorkflowsConfig.ready`.

On ``post_save`` of Lead / Contact / Account / Deal the receiver enqueues
:func:`workflows.tasks.evaluate_workflow_rules` with ``record_create``
(when ``created=True``) or ``record_update`` (otherwise). On
``post_delete`` it enqueues the same task with ``record_delete``.

The signal is deliberately not dispatched for raw loads (fixture installs),
for soft-delete / restore saves (``update_fields`` is
``{deleted_at, updated_at}``), or for records with no tenant.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db.models import Model
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

log = logging.getLogger(__name__)


_SKIP_UPDATE_FIELDS = {"deleted_at", "updated_at"}


def _should_enqueue(instance: Model, raw: bool, update_fields: Any) -> bool:
    """Return ``True`` when the workflow task should be enqueued."""
    if raw:
        return False
    if instance.tenant_id is None:
        return False
    if update_fields and set(update_fields).issubset(_SKIP_UPDATE_FIELDS):
        return False
    return True


def _target_model_for(instance: Model) -> str | None:
    """Map an instance to its workflow target_model string."""
    from accounts.models import Account
    from contacts.models import Contact
    from deals.models import Deal
    from leads.models import Lead

    if isinstance(instance, Deal):
        return "deal"
    if isinstance(instance, Lead):
        return "lead"
    if isinstance(instance, Contact):
        return "contact"
    if isinstance(instance, Account):
        return "account"
    return None


def _enqueue(instance: Model, trigger_type: str, target_model: str) -> None:
    """Dispatch the Celery evaluate task for ``instance``."""
    from workflows.tasks import evaluate_workflow_rules

    try:
        evaluate_workflow_rules.delay(
            tenant_id=instance.tenant_id,
            trigger_type=trigger_type,
            trigger_model=target_model,
            record_id=instance.pk,
        )
    except Exception:  # pragma: no cover — defensive
        log.exception(
            "workflows._enqueue: failed to dispatch task for %s pk=%s",
            target_model, instance.pk,
        )


def _post_save_handler(
    instance: Model, created: bool, raw: bool, update_fields: Any
) -> None:
    target_model = _target_model_for(instance)
    if target_model is None:
        return
    if not _should_enqueue(instance, raw, update_fields):
        return
    trigger_type = "record_create" if created else "record_update"
    _enqueue(instance, trigger_type, target_model)


def _post_delete_handler(instance: Model) -> None:
    target_model = _target_model_for(instance)
    if target_model is None:
        return
    if instance.tenant_id is None:
        return
    _enqueue(instance, "record_delete", target_model)


@receiver(post_save, sender="leads.Lead")
def lead_post_save_workflow(sender: type, instance: Model, created: bool, raw: bool, **kwargs: Any) -> None:
    _post_save_handler(instance, created, raw, kwargs.get("update_fields"))


@receiver(post_save, sender="contacts.Contact")
def contact_post_save_workflow(sender: type, instance: Model, created: bool, raw: bool, **kwargs: Any) -> None:
    _post_save_handler(instance, created, raw, kwargs.get("update_fields"))


@receiver(post_save, sender="accounts.Account")
def account_post_save_workflow(sender: type, instance: Model, created: bool, raw: bool, **kwargs: Any) -> None:
    _post_save_handler(instance, created, raw, kwargs.get("update_fields"))


@receiver(post_save, sender="deals.Deal")
def deal_post_save_workflow(sender: type, instance: Model, created: bool, raw: bool, **kwargs: Any) -> None:
    _post_save_handler(instance, created, raw, kwargs.get("update_fields"))


@receiver(post_delete, sender="leads.Lead")
def lead_post_delete_workflow(sender: type, instance: Model, **kwargs: Any) -> None:
    _post_delete_handler(instance)


@receiver(post_delete, sender="contacts.Contact")
def contact_post_delete_workflow(sender: type, instance: Model, **kwargs: Any) -> None:
    _post_delete_handler(instance)


@receiver(post_delete, sender="accounts.Account")
def account_post_delete_workflow(sender: type, instance: Model, **kwargs: Any) -> None:
    _post_delete_handler(instance)


@receiver(post_delete, sender="deals.Deal")
def deal_post_delete_workflow(sender: type, instance: Model, **kwargs: Any) -> None:
    _post_delete_handler(instance)


__all__ = [
    "account_post_delete_workflow",
    "account_post_save_workflow",
    "contact_post_delete_workflow",
    "contact_post_save_workflow",
    "deal_post_delete_workflow",
    "deal_post_save_workflow",
    "lead_post_delete_workflow",
    "lead_post_save_workflow",
]
