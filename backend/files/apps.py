"""Django app config for the files module."""

from __future__ import annotations

from django.apps import AppConfig


class FilesConfig(AppConfig):
    """App config for ``files``."""

    name = "files"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Files"
