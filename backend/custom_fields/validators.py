"""Per-field-type validator functions for custom fields.

Each function takes a raw value plus optional ``options`` dict and either
returns the normalized value or raises :class:`ValueError`. They are thin
wrappers over the canonical validators in :mod:`custom_fields.registry` —
kept as a separate module so callers can ``from custom_fields.validators
import validate_email, validate_picklist`` without depending on the whole
registry machinery.

The signatures follow the same convention so they can be plugged into
DRF serializers, Django model ``clean()`` hooks, or Celery tasks.
"""

from __future__ import annotations

from typing import Any

from .registry import REGISTRY, validate_value
from .models import (
    FIELD_TYPE_ADDRESS,
    FIELD_TYPE_CHECKBOX,
    FIELD_TYPE_CURRENCY,
    FIELD_TYPE_DATE,
    FIELD_TYPE_DATETIME,
    FIELD_TYPE_DECIMAL,
    FIELD_TYPE_EMAIL,
    FIELD_TYPE_FILE,
    FIELD_TYPE_FORMULA,
    FIELD_TYPE_IMAGE,
    FIELD_TYPE_LONG_TEXT,
    FIELD_TYPE_LOOKUP,
    FIELD_TYPE_MULTI_PICKLIST,
    FIELD_TYPE_NUMBER,
    FIELD_TYPE_PERCENT,
    FIELD_TYPE_PHONE,
    FIELD_TYPE_PICKLIST,
    FIELD_TYPE_RATING,
    FIELD_TYPE_RICH_TEXT,
    FIELD_TYPE_ROLLUP_SUMMARY,
    FIELD_TYPE_SUBFORM,
    FIELD_TYPE_TEXT,
    FIELD_TYPE_TIME,
    FIELD_TYPE_URL,
)

__all__ = [
    "validate_text",
    "validate_long_text",
    "validate_rich_text",
    "validate_number",
    "validate_currency",
    "validate_percent",
    "validate_decimal",
    "validate_date",
    "validate_datetime",
    "validate_time",
    "validate_email",
    "validate_phone",
    "validate_url",
    "validate_picklist",
    "validate_multi_picklist",
    "validate_checkbox",
    "validate_lookup",
    "validate_subform",
    "validate_formula",
    "validate_rollup_summary",
    "validate_file",
    "validate_image",
    "validate_rating",
    "validate_address",
    "validate_by_type",
    "FIELD_TYPE_TEXT",
    "FIELD_TYPE_LONG_TEXT",
    "FIELD_TYPE_RICH_TEXT",
    "FIELD_TYPE_NUMBER",
    "FIELD_TYPE_CURRENCY",
    "FIELD_TYPE_PERCENT",
    "FIELD_TYPE_DECIMAL",
    "FIELD_TYPE_DATE",
    "FIELD_TYPE_DATETIME",
    "FIELD_TYPE_TIME",
    "FIELD_TYPE_EMAIL",
    "FIELD_TYPE_PHONE",
    "FIELD_TYPE_URL",
    "FIELD_TYPE_PICKLIST",
    "FIELD_TYPE_MULTI_PICKLIST",
    "FIELD_TYPE_CHECKBOX",
    "FIELD_TYPE_LOOKUP",
    "FIELD_TYPE_SUBFORM",
    "FIELD_TYPE_FORMULA",
    "FIELD_TYPE_ROLLUP_SUMMARY",
    "FIELD_TYPE_FILE",
    "FIELD_TYPE_IMAGE",
    "FIELD_TYPE_RATING",
    "FIELD_TYPE_ADDRESS",
]


def _make(field_type: str) -> Any:
    """Return a callable ``validate(value, *, options=None) -> normalized``."""

    def _validate(value: Any, *, options: dict | None = None) -> Any:
        return validate_value(field_type, value, options=options)

    _validate.__name__ = f"validate_{field_type}"
    _validate.__doc__ = (
        f"Validate a value for the ``{field_type}`` custom-field type.\n\n"
        "Returns the normalized value or raises :class:`ValueError`."
    )
    return _validate


# Bind one validator per registered field type. The dict comprehension is
# intentional — it guarantees the set of exported validators always matches the
# registry's set of supported types.
_validators_by_type = {ft: _make(ft) for ft in REGISTRY}

validate_text = _validators_by_type[FIELD_TYPE_TEXT]
validate_long_text = _validators_by_type[FIELD_TYPE_LONG_TEXT]
validate_rich_text = _validators_by_type[FIELD_TYPE_RICH_TEXT]
validate_number = _validators_by_type[FIELD_TYPE_NUMBER]
validate_currency = _validators_by_type[FIELD_TYPE_CURRENCY]
validate_percent = _validators_by_type[FIELD_TYPE_PERCENT]
validate_decimal = _validators_by_type[FIELD_TYPE_DECIMAL]
validate_date = _validators_by_type[FIELD_TYPE_DATE]
validate_datetime = _validators_by_type[FIELD_TYPE_DATETIME]
validate_time = _validators_by_type[FIELD_TYPE_TIME]
validate_email = _validators_by_type[FIELD_TYPE_EMAIL]
validate_phone = _validators_by_type[FIELD_TYPE_PHONE]
validate_url = _validators_by_type[FIELD_TYPE_URL]
validate_picklist = _validators_by_type[FIELD_TYPE_PICKLIST]
validate_multi_picklist = _validators_by_type[FIELD_TYPE_MULTI_PICKLIST]
validate_checkbox = _validators_by_type[FIELD_TYPE_CHECKBOX]
validate_lookup = _validators_by_type[FIELD_TYPE_LOOKUP]
validate_subform = _validators_by_type[FIELD_TYPE_SUBFORM]
validate_formula = _validators_by_type[FIELD_TYPE_FORMULA]
validate_rollup_summary = _validators_by_type[FIELD_TYPE_ROLLUP_SUMMARY]
validate_file = _validators_by_type[FIELD_TYPE_FILE]
validate_image = _validators_by_type[FIELD_TYPE_IMAGE]
validate_rating = _validators_by_type[FIELD_TYPE_RATING]
validate_address = _validators_by_type[FIELD_TYPE_ADDRESS]


def validate_by_type(field_type: str, value: Any, *, options: dict | None = None) -> Any:
    """Dispatch to the validator for ``field_type``.

    Convenience entry point for code that already holds the field type as a
    string — equivalent to ``registry.validate_value``.
    """
    return validate_value(field_type, value, options=options)
