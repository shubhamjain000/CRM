"""Django app config for the data_security module."""

from __future__ import annotations

from django.apps import AppConfig


class DataSecurityConfig(AppConfig):
    """App config for ``data_security``."""

    name = "data_security"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Data Security"
