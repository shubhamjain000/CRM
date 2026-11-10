"""Django app config for the security_monitoring module."""

from __future__ import annotations

from django.apps import AppConfig


class SecurityMonitoringConfig(AppConfig):
    """App config for ``security_monitoring``."""

    name = "security_monitoring"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Security Monitoring"
