"""Django app config for the marketing module."""

from __future__ import annotations

from django.apps import AppConfig


class MarketingConfig(AppConfig):
    """App config for ``marketing``."""

    name = "marketing"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Marketing"
