"""Django app config for the sandbox module."""

from __future__ import annotations

from django.apps import AppConfig


class SandboxConfig(AppConfig):
    """App config for ``sandbox``."""

    name = "sandbox"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Configuration Sandboxes"
