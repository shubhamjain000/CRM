"""Django app config for the workflows module.

: meth:`WorkflowsConfig.ready` imports :mod:`workflows.signals` so the
``post_save`` / ``post_delete`` receivers on Lead / Contact / Account /
Deal enqueue the evaluation Celery task.
"""

from __future__ import annotations

from django.apps import AppConfig


class WorkflowsConfig(AppConfig):
    """App config for ``workflows``."""

    name = "workflows"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Workflow Automation"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        from . import signals  # noqa: F401
