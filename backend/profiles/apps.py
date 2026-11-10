"""Django app config for the profiles module."""

from __future__ import annotations

from django.apps import AppConfig


class ProfilesConfig(AppConfig):
    """App config for ``profiles``."""

    name = "profiles"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Permission Profiles"
