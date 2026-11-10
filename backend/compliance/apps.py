"""Django app config for the compliance module."""

from __future__ import annotations

from django.apps import AppConfig


class ComplianceConfig(AppConfig):
    """App config for ``compliance``."""

    name = "compliance"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Compliance"
