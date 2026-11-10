"""Signal handlers for the validation_rules app.

Wired in :meth:`validation_rules.apps.ValidationRulesConfig.ready`.

On ``pre_save`` of Lead / Contact / Account / Deal the receiver builds a
record dict from the instance, calls :meth:`ValidationService.enforce`,
and lets any ``ValidationError`` propagate up to Django's save() caller.
Warning-severity failures are logged but do not raise.

The signal is deliberately *not* dispatched for raw loads (fixture
installs) or for soft-delete saves (``update_fields`` restricted to
``deleted_at`` / ``updated_at``).
"""

from __future__ import annotations

import logging
from typing import Any

from django.core.exceptions import ValidationError
from django.db.models.base import Model
from django.db.models.signals import pre_save
from django.dispatch import receiver

log = logging.getLogger(__name__)


###############################################################################
# Helpers
###############################################################################


_SKIP_UPDATE_FIELDS = {"deleted_at", "updated_at"}


def _should_skip(instance: Model, update_fields: set[str] | None, raw: bool) -> bool:
    """Return ``True`` when the validation signal should be skipped."""
    if raw:
        return True
    if instance.tenant_id is None:
        return True
    if update_fields and update_fields.issubset(_SKIP_UPDATE_FIELDS):
        return True
    return False


def _record_to_dict(instance: Model) -> dict[str, Any]:
    """Project ``instance`` into a flat dict of concrete-field values."""
    out: dict[str, Any] = {}
    for field in instance._meta.concrete_fields:  # type: ignore[attr-defined]
        try:
            out[field.name] = getattr(instance, field.attname)
        except Exception:  # pragma: no cover — defensive
            continue
    return out


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


###############################################################################
# Receivers
###############################################################################


@receiver(pre_save, sender="leads.Lead")
def validate_lead_pre_save(
    sender: type,
    instance: Model,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Run validation rules on Lead pre_save."""
    _run_validation(instance, raw, kwargs.get("update_fields"))


@receiver(pre_save, sender="contacts.Contact")
def validate_contact_pre_save(
    sender: type,
    instance: Model,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Run validation rules on Contact pre_save."""
    _run_validation(instance, raw, kwargs.get("update_fields"))


@receiver(pre_save, sender="accounts.Account")
def validate_account_pre_save(
    sender: type,
    instance: Model,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Run validation rules on Account pre_save."""
    _run_validation(instance, raw, kwargs.get("update_fields"))


@receiver(pre_save, sender="deals.Deal")
def validate_deal_pre_save(
    sender: type,
    instance: Model,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Run validation rules on Deal pre_save."""
    _run_validation(instance, raw, kwargs.get("update_fields"))


def _run_validation(instance: Model, raw: bool, update_fields: Any) -> None:
    """Dispatch the validation service for ``instance``."""
    target_model = _target_model_for(instance)
    if target_model is None:
        return
    fields = set(update_fields) if update_fields else None
    if _should_skip(instance, fields, raw):
        return
    from validation_rules.services import ValidationService

    trigger = "update" if instance.pk else "create"
    record_data = _record_to_dict(instance)
    try:
        ValidationService().enforce(target_model, record_data, trigger=trigger)
    except ValidationError:
        # Re-raise so Django's save() caller sees the error.
        raise
    except Exception:  # pragma: no cover — defensive
        log.exception(
            "validation_rules._run_validation: failed for %s pk=%s",
            target_model, instance.pk,
        )


__all__ = [
    "validate_account_pre_save",
    "validate_contact_pre_save",
    "validate_deal_pre_save",
    "validate_lead_pre_save",
]
