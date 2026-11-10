"""Django app config for the canvas module."""

from __future__ import annotations

from django.apps import AppConfig


class CanvasConfig(AppConfig):
    """App config for ``canvas``."""

    name = "canvas"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Canvas Theming"
