"""Shared validators for CRM JSON-field lists (emails, phones, addresses)."""

from __future__ import annotations

import re
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import EmailValidator, URLValidator
from rest_framework.exceptions import ValidationError

_EMAIL_VALIDATOR = EmailValidator()
_URL_VALIDATOR = URLValidator()

_PHONE_RE = re.compile(r"^\+?[0-9][0-9\-\s().]{6,}$")
_ADDRESS_KEYS = {"line1", "city", "state", "postal_code", "country"}


def _ensure_list(value: Any, field_name: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError({field_name: "Must be a list."})
    return value


def validate_emails(value: Any, *, field_name: str = "emails") -> list[dict[str, str]]:
    """Validate and normalize an ``emails`` JSON list.

    Accepts either plain strings or ``{"email": "...", "type": "work"}`` dicts.
    """
    items = _ensure_list(value, field_name)
    out: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, str):
            email = item.strip()
            item_dict = {"email": email, "type": "work"}
        elif isinstance(item, dict):
            email = str(item.get("email", "")).strip()
            item_dict = {
                "email": email,
                "type": str(item.get("type", "work")) or "work",
            }
        else:
            raise ValidationError({field_name: "Each email must be a string or object."})
        try:
            _EMAIL_VALIDATOR(email)
        except DjangoValidationError:
            raise ValidationError({field_name: f"Invalid email: {email}"})
        out.append(item_dict)
    return out


def validate_phones(value: Any, *, field_name: str = "phones") -> list[dict[str, str]]:
    """Validate a ``phones`` JSON list."""
    items = _ensure_list(value, field_name)
    out: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, str):
            phone = item.strip()
            item_dict = {"phone": phone, "type": "work"}
        elif isinstance(item, dict):
            phone = str(item.get("phone", "")).strip()
            item_dict = {
                "phone": phone,
                "type": str(item.get("type", "work")) or "work",
            }
        else:
            raise ValidationError({field_name: "Each phone must be a string or object."})
        if phone and not _PHONE_RE.match(phone):
            raise ValidationError({field_name: f"Invalid phone: {phone}"})
        out.append(item_dict)
    return out


def validate_address(value: Any, *, field_name: str = "address") -> dict[str, Any]:
    """Validate a single address dict."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError({field_name: "Must be an object."})
    unknown = set(value) - _ADDRESS_KEYS
    if unknown:
        raise ValidationError({field_name: f"Unknown address keys: {sorted(unknown)}"})
    return value


def validate_url(value: Any, *, field_name: str = "website") -> str:
    if not value:
        return ""
    try:
        _URL_VALIDATOR(value)
    except DjangoValidationError:
        raise ValidationError({field_name: f"Invalid URL: {value}"})
    return str(value)
