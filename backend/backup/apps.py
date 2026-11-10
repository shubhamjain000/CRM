"""Django app config for the backup module."""

from __future__ import annotations

from django.apps import AppConfig


class BackupConfig(AppConfig):
    """App config for ``backup``."""

    name = "backup"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Backup"
