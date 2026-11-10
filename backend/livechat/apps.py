"""Django app config for the livechat module."""

from __future__ import annotations

from django.apps import AppConfig


class LiveChatConfig(AppConfig):
    """App config for ``livechat``."""

    name = "livechat"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Live Chat"
