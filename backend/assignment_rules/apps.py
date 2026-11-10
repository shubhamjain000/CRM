"""Django app config for the assignment_rules module.

:meth:`AssignmentRulesConfig.ready` imports :mod:`assignment_rules.signals`
so the ``post_save(created=True)`` receivers on Lead / Contact / Account
/ Deal enqueue the Celery task that evaluates the assignment rules.
"""

from __future__ import annotations

from django.apps import AppConfig


class AssignmentRulesConfig(AppConfig):
    """App config for ``assignment_rules``."""

    name = "assignment_rules"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Assignment Rules"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        from . import signals  # noqa: F401
