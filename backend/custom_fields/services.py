"""Service layer for custom fields.

These functions are the canonical interface used by CRM serializers and the
backfill Celery task. They:

* read custom field *definitions* per (tenant, module),
* read custom field *values* in batch (efficient for list endpoints),
* write a single value (validating against the field-type registry),
* backfill default values for all existing records of a module.

Values are stored in :class:`custom_fields.models.CustomFieldValue` keyed by
``record_id`` (stringified model pk).
"""

from __future__ import annotations

import logging
from typing import Any, Iterable

from django.db import transaction

from .models import CustomField, CustomFieldValue
from .registry import validate_value

log = logging.getLogger(__name__)


def get_custom_fields(tenant_id: int, module: str) -> list[CustomField]:
    """Return the list of :class:`CustomField` definitions for ``(tenant, module)``."""
    return list(
        CustomField.objects.filter(tenant_id=tenant_id, module=module, deleted_at__isnull=True)
    )


def get_values(
    *, tenant_id: int, module: str, record_ids: Iterable[str]
) -> dict[str, dict[str, Any]]:
    """Batch-read custom field values for ``record_ids``.

    Returns ``{record_id: {api_name: value, ...}, ...}``. Records without
    values get an empty dict.
    """
    ids = [str(r) for r in record_ids]
    if not ids:
        return {}
    rows = (
        CustomFieldValue.objects.select_related("field")
        .filter(
            tenant_id=tenant_id,
            module=module,
            record_id__in=ids,
            deleted_at__isnull=True,
        )
        .exclude(field__deleted_at__isnull=False)
    )
    out: dict[str, dict[str, Any]] = {rid: {} for rid in ids}
    for row in rows:
        out.setdefault(row.record_id, {})[row.field.api_name] = row.value
    return out


def set_value(
    *,
    tenant_id: int,
    module: str,
    record_id: str,
    field: CustomField,
    value: Any,
) -> CustomFieldValue:
    """Validate ``value`` against the field's type and upsert the row.

    Raises :class:`ValueError` if the value is invalid.
    """
    normalized = validate_value(field.field_type, value, options=field.field_options or {})
    with transaction.atomic():
        obj, created = CustomFieldValue.objects.update_or_create(
            field=field,
            record_id=str(record_id),
            defaults={
                "tenant_id": tenant_id,
                "module": module,
                "value": normalized,
            },
        )
    return obj


def apply_defaults(*, tenant_id: int, module: str, record_id: str) -> int:
    """Backfill default values for a single record.

    Called by CRM model ``save()`` signals (when wired) and by the bulk
    backfill task. Returns the count of values written.
    """
    fields = get_custom_fields(tenant_id=tenant_id, module=module)
    if not fields:
        return 0
    existing = {
        row.field_id: row
        for row in CustomFieldValue.objects.filter(
            tenant_id=tenant_id, module=module, record_id=str(record_id)
        )
    }
    written = 0
    for field in fields:
        if not field.default_value:
            continue
        if field.pk in existing:
            continue
        try:
            set_value(
                tenant_id=tenant_id,
                module=module,
                record_id=str(record_id),
                field=field,
                value=field.default_value,
            )
            written += 1
        except ValueError:
            log.warning(
                "custom_fields.apply_defaults: default %r for field %s is invalid; skipped.",
                field.default_value,
                field.api_name,
            )
    return written


def apply_defaults_for_module(*, tenant_id: int, module: str, model: type) -> int:
    """Bulk-backfill defaults for every record of ``model`` in ``tenant``.

    Used by the post_save signal's Celery task. ``model`` is the CRM model
    class (e.g. ``accounts.models.Account``). Returns the count of records
    touched.
    """
    qs = model.objects.all().for_tenant(tenant_id) if hasattr(model.objects, "for_tenant") else model.objects.filter(tenant_id=tenant_id)  # type: ignore[union-attr]
    total = 0
    for record in qs.iterator(chunk_size=200):
        n = apply_defaults(tenant_id=tenant_id, module=module, record_id=str(record.pk))
        total += 1 if n > 0 else 0
    return total


def delete_values_for_record(*, tenant_id: int, module: str, record_id: str) -> int:
    """Delete all custom field values for a record (used on hard delete)."""
    deleted, _ = (
        CustomFieldValue.objects.filter(
            tenant_id=tenant_id, module=module, record_id=str(record_id)
        ).delete()
    )
    return deleted


# Lazy module → model mapping. Resolved at call-time to avoid import cycles.
_MODULE_TO_MODEL_PATH: dict[str, str] = {
    "lead": "leads.models.Lead",
    "contact": "contacts.models.Contact",
    "account": "accounts.models.Account",
    "deal": "deals.models.Deal",
}


def resolve_module_model(module: str) -> type:
    """Return the Django model class for a custom-field module string."""
    from django.apps import apps

    path = _MODULE_TO_MODEL_PATH.get(module)
    if path is None:
        raise ValueError(f"Unknown custom field module: {module!r}")
    app_label, model_name = path.rsplit(".", 1)
    return apps.get_model(app_label, model_name)
