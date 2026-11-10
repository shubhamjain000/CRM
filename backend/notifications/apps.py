"""Django app config for the ``notifications`` module."""

from __future__ import annotations

from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    """App config for ``notifications``."""

    name = "notifications"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Notifications"
