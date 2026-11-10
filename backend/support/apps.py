"""Django app config for the support module."""

from __future__ import annotations

from django.apps import AppConfig


class SupportConfig(AppConfig):
    """App config for ``support``."""

    name = "support"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Support"
