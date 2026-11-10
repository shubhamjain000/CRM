"""Django app config for the events module."""

from __future__ import annotations

from django.apps import AppConfig


class EventsConfig(AppConfig):
    """App config for ``events``."""

    name = "events"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Events"
