"""Django app config for the attachments module."""

from __future__ import annotations

from django.apps import AppConfig


class AttachmentsConfig(AppConfig):
    """App config for ``attachments``."""

    name = "attachments"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Attachments"
