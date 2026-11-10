"""Django app config for the goals module."""

from __future__ import annotations

from django.apps import AppConfig


class GoalsConfig(AppConfig):
    """App config for ``goals``."""

    name = "goals"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Goals & Achievements"
