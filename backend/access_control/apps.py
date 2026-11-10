"""Django app config for the access_control module."""

from __future__ import annotations

from django.apps import AppConfig


class AccessControlConfig(AppConfig):
    """App config for ``access_control``."""

    name = "access_control"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Access Control"
