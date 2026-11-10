"""Django app config for the telephony module."""

from __future__ import annotations

from django.apps import AppConfig


class TelephonyConfig(AppConfig):
    """App config for ``telephony``."""

    name = "telephony"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Telephony"
