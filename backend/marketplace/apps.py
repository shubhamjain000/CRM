"""Django app config for the marketplace module."""

from __future__ import annotations

from django.apps import AppConfig


class MarketplaceConfig(AppConfig):
    """App config for ``marketplace``."""

    name = "marketplace"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Marketplace"
