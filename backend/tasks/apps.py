"""Django app config for the tasks module.

Imports :mod:`tasks.signals` in :meth:`TasksConfig.ready` so the
``post_save`` receivers on :class:`tasks.models.Task` are connected when the
app registry is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class TasksConfig(AppConfig):
    """App config for ``tasks``."""

    name = "tasks"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Tasks"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the signals module connects the @receiver-decorated handlers.
        from . import signals  # noqa: F401
