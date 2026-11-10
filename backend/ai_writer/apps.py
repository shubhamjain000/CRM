"""Django app config for the ai_writer module."""

from __future__ import annotations

from django.apps import AppConfig


class AIWriterConfig(AppConfig):
    """App config for ``ai_writer``."""

    name = "ai_writer"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "AI Writer"
