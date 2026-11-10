"""Django app config for the dashboards module."""

from __future__ import annotations

from django.apps import AppConfig


class DashboardsConfig(AppConfig):
    """App config for ``dashboards``."""

    name = "dashboards"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Dashboards"
