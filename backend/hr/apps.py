"""Django app config for the hr module."""

from __future__ import annotations

from django.apps import AppConfig


class HrConfig(AppConfig):
    """App config for ``hr``."""

    name = "hr"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "HR"
