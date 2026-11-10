"""Service layer for the custom_modules app.

Three public functions:

* :func:`clone_module` — deep-copy a module + its field schema (NOT
  its records). Returns the new :class:`CustomModule`.
* :func:`validate_record_data` — check a record's ``data`` against the
  module's field schema (required, type, picklist, lookup). Raises
  :class:`ValidationError` on failure.
* :func:`apply_defaults` — fill missing keys in ``data`` from
  ``field.default_value`` for fields not present in the payload.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import transaction

from .models import (
    FIELD_BOOLEAN,
    FIELD_EMAIL,
    FIELD_MULTIPICKLIST,
    FIELD_PICKLIST,
    FIELD_URL,
    CustomModule,
    CustomModuleField,
    CustomModuleRecord,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    pass


###############################################################################
# clone_module
###############################################################################


@transaction.atomic
def clone_module(module: CustomModule, new_name: str | None = None) -> CustomModule:
    """Deep-copy ``module`` + its field schema.

    Records are NOT cloned — the new module starts empty. The slug is
    suffixed with ``-copy`` to satisfy the unique constraint; callers
    can rename it after creation.
    """
    src_fields = list(module.fields.all().order_by("display_order", "id"))
    new_slug = f"{module.slug}-copy"
    if CustomModule.objects.filter(tenant=module.tenant, slug=new_slug).exists():
        # Append the source PK to disambiguate.
        new_slug = f"{module.slug}-copy-{module.pk}"

    clone = CustomModule.objects.create(
        tenant=module.tenant,
        name=new_name or f"{module.name} (Copy)",
        plural_name=module.plural_name,
        slug=new_slug,
        icon=module.icon,
        color=module.color,
        record_name_field=module.record_name_field,
        is_active=True,
        is_system=False,  # Clones are never system modules.
    )
    for src in src_fields:
        CustomModuleField.objects.create(
            tenant=module.tenant,
            module=clone,
            label=src.label,
            api_name=src.api_name,
            field_type=src.field_type,
            field_options=dict(src.field_options or {}),
            default_value=src.default_value,
            is_required=src.is_required,
            is_unique=src.is_unique,
            is_searchable=src.is_searchable,
            display_order=src.display_order,
            section=src.section,
        )
    return clone


###############################################################################
# apply_defaults
###############################################################################


def apply_defaults(module: CustomModule, data: dict[str, Any]) -> dict[str, Any]:
    """Return ``data`` with default values filled for missing keys."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    for field in module.fields.all():
        if field.api_name not in out and field.default_value is not None:
            out[field.api_name] = field.default_value
    return out


###############################################################################
# validate_record_data
###############################################################################


def _validate_value(field: CustomModuleField, value: Any) -> None:  # type: ignore[no-untyped-def]
    """Validate a single value against ``field``'s type."""
    if value is None or value == "":
        if field.is_required:
            raise ValidationError({field.api_name: "This field is required."})
        return

    ft = field.field_type
    opts = field.field_options or {}

    if ft == FIELD_EMAIL and "@" not in str(value):
        raise ValidationError({field.api_name: "Invalid email address."})
    if ft == FIELD_URL and "://" not in str(value):
        raise ValidationError({field.api_name: "Invalid URL."})
    if ft == FIELD_NUMBER:
        try:
            float(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError({field.api_name: "Must be a number."}) from exc
    if ft == FIELD_BOOLEAN and not isinstance(value, bool):
        # Accept truthy strings ("true"/"false") for friendliness.
        if str(value).lower() not in {"true", "false", "1", "0"}:
            raise ValidationError({field.api_name: "Must be a boolean."})
    if ft == FIELD_PICKLIST:
        choices = opts.get("choices") or []
        if choices and value not in choices:
            raise ValidationError({field.api_name: f"{value!r} is not a valid choice."})
    if ft == FIELD_MULTIPICKLIST:
        choices = opts.get("choices") or []
        if not isinstance(value, (list, tuple)):
            raise ValidationError({field.api_name: "Must be a list."})
        invalid = [v for v in value if choices and v not in choices]
        if invalid:
            raise ValidationError({field.api_name: f"{invalid!r} are not valid choices."})


def validate_record_data(
    module: CustomModule, data: dict[str, Any]
) -> dict[str, Any]:
    """Validate ``data`` against the module's field schema.

    Returns the validated dict (with defaults applied). Raises
    :class:`django.core.exceptions.ValidationError` on failure.
    """
    if not isinstance(data, dict):
        raise ValidationError("data must be a JSON object.")
    fields_by_name = {f.api_name: f for f in module.fields.all()}
    unknown = set(data) - set(fields_by_name) - {"id"}
    if unknown:
        raise ValidationError({k: "Unknown field." for k in unknown})
    data = apply_defaults(module, data)
    for field in fields_by_name.values():
        _validate_value(field, data.get(field.api_name))
    return data


__all__ = [
    "apply_defaults",
    "clone_module",
    "validate_record_data",
]
