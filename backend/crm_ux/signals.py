"""Signal handlers that auto-log CRM activities.

Wired in :meth:`crm_ux.apps.CrmUxConfig.ready`.

For each of ``Lead`` / ``Contact`` / ``Account`` / ``Deal``:

* ``post_save`` with ``created=True`` → log ``created``.
* ``post_save`` with ``update_fields`` containing ``deleted_at``:
    - ``instance.deleted_at`` set → log ``deleted`` (soft delete).
    - ``instance.deleted_at`` cleared → log ``restored``.
* ``post_save`` otherwise (update) → log ``updated``.

System / fixture loads (``raw=True``) and instances without a tenant (e.g.
during migrations) are skipped to keep fixtures deterministic.

The CRM models are imported at module load time — this is safe because the
module is only imported from :meth:`CrmUxConfig.ready`, which fires *after*
the full app registry is populated. The CRM apps are listed before
``crm_ux`` in ``INSTALLED_APPS`` so their models are guaranteed to exist.
"""

from __future__ import annotations

from typing import Any

from django.db.models.base import ModelBase
from django.db.models.signals import post_save
from django.dispatch import receiver

from accounts.models import Account
from contacts.models import Contact
from deals.models import Deal
from leads.models import Lead

from .services import _actor_for, _record_name, log_activity


#: CRM model class → module string used by :class:`crm_ux.models.Activity`.
_MODULE_FOR_MODEL: dict[ModelBase, str] = {
    Lead: "lead",
    Contact: "contact",
    Account: "account",
    Deal: "deal",
}


def _should_skip(instance: Any, raw: bool) -> bool:
    """Return ``True`` if the signal should no-op for this save."""
    if raw:
        return True
    if getattr(instance, "tenant_id", None) is None:
        return True
    return False


def _log_save(
    *,
    sender: ModelBase,
    instance: Any,
    created: bool,
    update_fields: tuple[str, ...] | None,
) -> None:
    """Dispatch the right ``log_activity`` call for a CRM record save."""
    module = _MODULE_FOR_MODEL.get(sender)
    if module is None:  # pragma: no cover — defensive; sender is always a CRM model
        return

    if created:
        action = "created"
        description = f"Created {module} '{_record_name(instance)}'."
    elif update_fields and "deleted_at" in update_fields:
        if instance.deleted_at is not None:
            action = "deleted"
            description = f"Soft-deleted {module} '{_record_name(instance)}'."
        else:
            action = "restored"
            description = f"Restored {module} '{_record_name(instance)}'."
    else:
        action = "updated"
        description = f"Updated {module} '{_record_name(instance)}'."

    log_activity(
        tenant=instance.tenant,
        user=_actor_for(instance),
        module=module,
        record_id=str(instance.pk),
        record_name=_record_name(instance),
        action=action,
        description=description,
    )


@receiver(post_save, sender=Lead)
def lead_post_save(
    sender: ModelBase,
    instance: Lead,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Auto-log Lead create / update / soft-delete / restore."""
    if _should_skip(instance, raw):
        return
    _log_save(
        sender=sender,
        instance=instance,
        created=created,
        update_fields=kwargs.get("update_fields"),
    )


@receiver(post_save, sender=Contact)
def contact_post_save(
    sender: ModelBase,
    instance: Contact,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Auto-log Contact create / update / soft-delete / restore."""
    if _should_skip(instance, raw):
        return
    _log_save(
        sender=sender,
        instance=instance,
        created=created,
        update_fields=kwargs.get("update_fields"),
    )


@receiver(post_save, sender=Account)
def account_post_save(
    sender: ModelBase,
    instance: Account,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Auto-log Account create / update / soft-delete / restore."""
    if _should_skip(instance, raw):
        return
    _log_save(
        sender=sender,
        instance=instance,
        created=created,
        update_fields=kwargs.get("update_fields"),
    )


@receiver(post_save, sender=Deal)
def deal_post_save(
    sender: ModelBase,
    instance: Deal,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Auto-log Deal create / update / soft-delete / restore."""
    if _should_skip(instance, raw):
        return
    _log_save(
        sender=sender,
        instance=instance,
        created=created,
        update_fields=kwargs.get("update_fields"),
    )
