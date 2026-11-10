"""Django app config for the inbox module."""

from __future__ import annotations

from django.apps import AppConfig


class InboxConfig(AppConfig):
    """App config for ``inbox``."""

    name = "inbox"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Unified Inbox"
