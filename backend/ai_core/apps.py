"""Django app config for the ai_core module."""

from __future__ import annotations

from django.apps import AppConfig


class AICoreConfig(AppConfig):
    """App config for ``ai_core``."""

    name = "ai_core"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "AI Core Orchestrator"
