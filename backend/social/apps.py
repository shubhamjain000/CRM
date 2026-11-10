"""Django app config for the social module."""

from __future__ import annotations

from django.apps import AppConfig


class SocialConfig(AppConfig):
    """App config for ``social``."""

    name = "social"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Social"
