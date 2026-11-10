"""Django app config for the native_integrations module."""

from __future__ import annotations

from django.apps import AppConfig


class NativeIntegrationsConfig(AppConfig):
    """App config for ``native_integrations``."""

    name = "native_integrations"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Native Integrations"
