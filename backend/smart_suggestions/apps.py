"""Django app config for the smart_suggestions module."""

from __future__ import annotations

from django.apps import AppConfig


class SmartSuggestionsConfig(AppConfig):
    """App config for ``smart_suggestions``."""

    name = "smart_suggestions"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Smart Suggestions"
