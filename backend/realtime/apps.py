"""Django app config for the ``realtime`` module."""

from __future__ import annotations

from django.apps import AppConfig


class RealtimeConfig(AppConfig):
    """App config for ``realtime``."""

    name = "realtime"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Realtime"
