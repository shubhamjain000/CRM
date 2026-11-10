"""Django app config for the layouts module."""

from __future__ import annotations

from django.apps import AppConfig


class LayoutsConfig(AppConfig):
    """App config for ``layouts``."""

    name = "layouts"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Page Layouts"
