"""Django app config for the custom_functions module."""

from __future__ import annotations

from django.apps import AppConfig


class CustomFunctionsConfig(AppConfig):
    """App config for ``custom_functions``."""

    name = "custom_functions"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Custom Functions Scripting Engine"
