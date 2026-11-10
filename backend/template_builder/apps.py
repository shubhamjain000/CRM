"""Django app config for the template_builder module."""

from __future__ import annotations

from django.apps import AppConfig


class TemplateBuilderConfig(AppConfig):
    """App config for ``template_builder``."""

    name = "template_builder"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Template Builder"
