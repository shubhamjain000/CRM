"""Django app config for the custom_modules module."""

from __future__ import annotations

from django.apps import AppConfig


class CustomModulesConfig(AppConfig):
    """App config for ``custom_modules``."""

    name = "custom_modules"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Custom Modules"
