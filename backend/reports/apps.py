"""Django app config for the reports module."""

from __future__ import annotations

from django.apps import AppConfig


class ReportsConfig(AppConfig):
    """App config for ``reports``."""

    name = "reports"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Reports & Analytics"
