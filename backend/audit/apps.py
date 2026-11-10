"""Django app config for the audit module."""

from __future__ import annotations

from django.apps import AppConfig


class AuditConfig(AppConfig):
    """App config for ``audit``."""

    name = "audit"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Audit Log"
