"""Custom-field type registry.

Maps each of the 25 ``field_type``s to:

* a ``validator`` callable that takes the raw value and either returns the
  normalized value or raises :class:`ValueError` / ``ValidationError``;
* a DRF ``serializer_field`` class used to coerce values in API payloads.

The registry is the single source of truth for the type system. New types
are added by appending a :class:`FieldTypeHandler` to ``REGISTRY``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import EmailValidator, URLValidator
from rest_framework import serializers

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

_EMAIL_VALIDATOR = EmailValidator()
_URL_VALIDATOR = URLValidator()
_PHONE_RE = re.compile(r"^\+?[0-9][0-9\-\s().]{6,}$")


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _coerce_long_text(value: Any) -> str:
    return _coerce_text(value)


def _coerce_rich_text(value: Any) -> str:
    return _coerce_text(value)


def _coerce_number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Cannot coerce {value!r} to number.") from exc


def _coerce_currency(value: Any) -> str:
    """Store currency as a string to preserve Decimal precision."""
    if value is None or value == "":
        return "0"
    try:
        return str(Decimal(str(value)))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"Cannot coerce {value!r} to currency.") from exc


def _coerce_percent(value: Any) -> float:
    n = _coerce_number(value)
    if n < 0 or n > 100:
        raise ValueError("percent must be between 0 and 100.")
    return n


def _coerce_decimal(value: Any) -> str:
    return _coerce_currency(value)


def _coerce_date(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    try:
        return datetime.fromisoformat(str(value)).date().isoformat()
    except ValueError as exc:
        raise ValueError(f"Invalid ISO date: {value!r}") from exc


def _coerce_datetime(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    try:
        return datetime.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise ValueError(f"Invalid ISO datetime: {value!r}") from exc


def _coerce_time(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, time):
        return value.isoformat()
    try:
        return time.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise ValueError(f"Invalid ISO time: {value!r}") from exc


def _coerce_email(value: Any) -> str:
    if value is None or value == "":
        return ""
    text = str(value).strip()
    try:
        _EMAIL_VALIDATOR(text)
    except DjangoValidationError as exc:
        raise ValueError(f"Invalid email: {text}") from exc
    return text


def _coerce_phone(value: Any) -> str:
    if value is None or value == "":
        return ""
    text = str(value).strip()
    if not _PHONE_RE.match(text):
        raise ValueError(f"Invalid phone: {text}")
    return text


def _coerce_url(value: Any) -> str:
    if value is None or value == "":
        return ""
    text = str(value).strip()
    try:
        _URL_VALIDATOR(text)
    except DjangoValidationError as exc:
        raise ValueError(f"Invalid URL: {text}") from exc
    return text


def _coerce_picklist(value: Any, *, options: dict | None = None) -> str:
    if value is None or value == "":
        return ""
    text = str(value)
    choices = (options or {}).get("choices") or []
    if choices and text not in choices:
        raise ValueError(f"{text!r} not in picklist choices {choices}.")
    return text


def _coerce_multi_picklist(value: Any, *, options: dict | None = None) -> list[str]:
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise ValueError("multi_picklist value must be a list.")
    choices = (options or {}).get("choices") or []
    out: list[str] = []
    for item in value:
        text = str(item)
        if choices and text not in choices:
            raise ValueError(f"{text!r} not in picklist choices {choices}.")
        out.append(text)
    return out


def _coerce_checkbox(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    text = str(value).lower()
    if text in {"true", "1", "yes", "on"}:
        return True
    if text in {"false", "0", "no", "off", ""}:
        return False
    raise ValueError(f"Cannot coerce {value!r} to boolean.")


def _coerce_lookup(value: Any) -> str:
    if value is None or value == "":
        return ""
    return str(value)


def _coerce_subform(value: Any) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("subform value must be a list of objects.")
    return value


def _coerce_formula(value: Any) -> Any:
    return value


def _coerce_rollup_summary(value: Any) -> Any:
    return value


def _coerce_file(value: Any) -> str:
    return _coerce_text(value)


def _coerce_image(value: Any) -> str:
    return _coerce_text(value)


def _coerce_rating(value: Any) -> int:
    n = int(_coerce_number(value))
    if n < 0 or n > 5:
        raise ValueError("rating must be between 0 and 5.")
    return n


def _coerce_address(value: Any) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("address value must be an object.")
    return value


@dataclass(frozen=True)
class FieldTypeHandler:
    """Validator + DRF serializer field for a custom field type."""

    field_type: str
    validator: Callable[..., Any]
    serializer_field: type[serializers.Field]
    # Whether the validator accepts the field's ``field_options`` kwarg.
    uses_options: bool = False


def _make_validator_wrapper(validator: Callable[..., Any], uses_options: bool) -> Callable[..., Any]:
    """Return a uniform ``validate(value, options=None)`` wrapper."""

    def _validate(value: Any, *, options: dict | None = None) -> Any:
        if uses_options:
            return validator(value, options=options)
        return validator(value)

    return _validate


# Handler table — keyed by field_type.
_RAW_HANDLERS: dict[str, tuple[Callable[..., Any], type[serializers.Field], bool]] = {
    FIELD_TYPE_TEXT: (_coerce_text, serializers.CharField, False),
    FIELD_TYPE_LONG_TEXT: (_coerce_long_text, serializers.CharField, False),
    FIELD_TYPE_RICH_TEXT: (_coerce_rich_text, serializers.CharField, False),
    FIELD_TYPE_NUMBER: (_coerce_number, serializers.FloatField, False),
    FIELD_TYPE_CURRENCY: (_coerce_currency, serializers.CharField, False),
    FIELD_TYPE_PERCENT: (_coerce_percent, serializers.FloatField, False),
    FIELD_TYPE_DECIMAL: (_coerce_decimal, serializers.CharField, False),
    FIELD_TYPE_DATE: (_coerce_date, serializers.DateField, False),
    FIELD_TYPE_DATETIME: (_coerce_datetime, serializers.DateTimeField, False),
    FIELD_TYPE_TIME: (_coerce_time, serializers.TimeField, False),
    FIELD_TYPE_EMAIL: (_coerce_email, serializers.EmailField, False),
    FIELD_TYPE_PHONE: (_coerce_phone, serializers.CharField, False),
    FIELD_TYPE_URL: (_coerce_url, serializers.URLField, False),
    FIELD_TYPE_PICKLIST: (_coerce_picklist, serializers.ChoiceField, True),
    FIELD_TYPE_MULTI_PICKLIST: (_coerce_multi_picklist, serializers.ListField, True),
    FIELD_TYPE_CHECKBOX: (_coerce_checkbox, serializers.BooleanField, False),
    FIELD_TYPE_LOOKUP: (_coerce_lookup, serializers.CharField, False),
    FIELD_TYPE_SUBFORM: (_coerce_subform, serializers.ListField, False),
    FIELD_TYPE_FORMULA: (_coerce_formula, serializers.JSONField, False),
    FIELD_TYPE_ROLLUP_SUMMARY: (_coerce_rollup_summary, serializers.JSONField, False),
    FIELD_TYPE_FILE: (_coerce_file, serializers.CharField, False),
    FIELD_TYPE_IMAGE: (_coerce_image, serializers.CharField, False),
    FIELD_TYPE_RATING: (_coerce_rating, serializers.IntegerField, False),
    FIELD_TYPE_ADDRESS: (_coerce_address, serializers.DictField, False),
}


REGISTRY: dict[str, FieldTypeHandler] = {
    ft: FieldTypeHandler(
        field_type=ft,
        validator=_make_validator_wrapper(validator, uses_options),
        serializer_field=serializer_field,
        uses_options=uses_options,
    )
    for ft, (validator, serializer_field, uses_options) in _RAW_HANDLERS.items()
}


def get_handler(field_type: str) -> FieldTypeHandler:
    """Return the handler for ``field_type`` or raise ``KeyError``."""
    return REGISTRY[field_type]


def validate_value(field_type: str, value: Any, *, options: dict | None = None) -> Any:
    """Validate ``value`` for ``field_type`` and return the normalized value.

    Raises :class:`ValueError` on invalid input.
    """
    handler = get_handler(field_type)
    return handler.validator(value, options=options)


def build_serializer_field(field: "CustomField") -> serializers.Field:  # type: ignore[name-defined]
    """Build a DRF serializer field instance for ``field``.

    Used by the per-record custom-field serializer in
    :mod:`custom_fields.serializers`.
    """
    handler = get_handler(field.field_type)
    kwargs: dict[str, Any] = {
        "required": field.is_required,
        "allow_null": not field.is_required,
    }
    if field.field_type == FIELD_TYPE_PICKLIST:
        kwargs["choices"] = (field.field_options or {}).get("choices") or []
    if field.default_value and not kwargs.get("allow_null"):
        kwargs["default"] = field.default_value
    return handler.serializer_field(**kwargs)
