"""Django app config for the territories module."""

from __future__ import annotations

from django.apps import AppConfig


class TerritoriesConfig(AppConfig):
    """App config for ``territories``."""

    name = "territories"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Territories"
