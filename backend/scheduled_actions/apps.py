"""Django app config for the scheduled_actions module."""

from __future__ import annotations

from django.apps import AppConfig


class ScheduledActionsConfig(AppConfig):
    """App config for ``scheduled_actions``."""

    name = "scheduled_actions"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Scheduled Actions"
