"""Signal handlers for the assignment_rules app.

Wired in :meth:`assignment_rules.apps.AssignmentRulesConfig.ready`.

On ``post_save(created=True)`` of Lead / Contact / Account / Deal the
receiver enqueues :func:`assignment_rules.tasks.evaluate_assignment_rules`
so the rule set is evaluated on a worker rather than on the request path.
The task resolves the user, updates the record's ``owner``, and logs an
:class:`AssignmentHistory` row.

The signal is deliberately *not* dispatched for raw loads (fixture
installs), for updates (only fires on ``created=True``), or for
soft-delete / restore saves (``update_fields`` is
``{deleted_at, updated_at}``).
"""

from __future__ import annotations

import logging
from typing import Any

from django.db.models import Model
from django.db.models.signals import post_save
from django.dispatch import receiver

log = logging.getLogger(__name__)


_SKIP_UPDATE_FIELDS = {"deleted_at", "updated_at"}


def _should_enqueue(instance: Model, created: bool, raw: bool, update_fields: Any) -> bool:
    """Return ``True`` when the assignment-rules task should be enqueued."""
    if raw or not created:
        return False
    if instance.tenant_id is None:
        return False
    if update_fields and set(update_fields).issubset(_SKIP_UPDATE_FIELDS):
        return False
    return True


def _target_model_for(instance: Model) -> str | None:
    """Map an instance to its rule-engine target_model string."""
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


def _enqueue(instance: Model, target_model: str) -> None:
    """Dispatch the Celery task for ``instance``."""
    from assignment_rules.tasks import evaluate_assignment_rules

    try:
        evaluate_assignment_rules.delay(
            tenant_id=instance.tenant_id,
            record_module=target_model,
            record_id=instance.pk,
        )
    except Exception:  # pragma: no cover — defensive
        log.exception(
            "assignment_rules._enqueue: failed to dispatch task for %s pk=%s",
            target_model, instance.pk,
        )


@receiver(post_save, sender="leads.Lead")
def lead_post_save_assign(
    sender: type,
    instance: Model,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Enqueue the assignment-rules task on Lead create."""
    target_model = _target_model_for(instance)
    if target_model is None:
        return
    if not _should_enqueue(instance, created, raw, kwargs.get("update_fields")):
        return
    _enqueue(instance, target_model)


@receiver(post_save, sender="contacts.Contact")
def contact_post_save_assign(
    sender: type,
    instance: Model,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Enqueue the assignment-rules task on Contact create."""
    target_model = _target_model_for(instance)
    if target_model is None:
        return
    if not _should_enqueue(instance, created, raw, kwargs.get("update_fields")):
        return
    _enqueue(instance, target_model)


@receiver(post_save, sender="accounts.Account")
def account_post_save_assign(
    sender: type,
    instance: Model,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Enqueue the assignment-rules task on Account create."""
    target_model = _target_model_for(instance)
    if target_model is None:
        return
    if not _should_enqueue(instance, created, raw, kwargs.get("update_fields")):
        return
    _enqueue(instance, target_model)


@receiver(post_save, sender="deals.Deal")
def deal_post_save_assign(
    sender: type,
    instance: Model,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Enqueue the assignment-rules task on Deal create."""
    target_model = _target_model_for(instance)
    if target_model is None:
        return
    if not _should_enqueue(instance, created, raw, kwargs.get("update_fields")):
        return
    _enqueue(instance, target_model)


__all__ = [
    "account_post_save_assign",
    "contact_post_save_assign",
    "deal_post_save_assign",
    "lead_post_save_assign",
]
