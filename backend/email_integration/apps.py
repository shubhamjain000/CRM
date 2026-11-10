"""Django app config for the email_integration module."""

from __future__ import annotations

from django.apps import AppConfig


class EmailIntegrationConfig(AppConfig):
    """App config for ``email_integration``."""

    name = "email_integration"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Email Integration"
