"""Django app config for the analytics module."""

from __future__ import annotations

from django.apps import AppConfig


class AnalyticsConfig(AppConfig):
    """App config for ``analytics``."""

    name = "analytics"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Pre-built Analytics Dashboards"
