"""Django app config for the projects module."""

from __future__ import annotations

from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    """App config for ``projects``."""

    name = "projects"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Projects"
