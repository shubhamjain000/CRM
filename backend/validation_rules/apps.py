"""Django app config for the validation_rules module.

:meth:`ValidationRulesConfig.ready` imports :mod:`validation_rules.signals`
so the ``pre_save`` receivers on Lead / Contact / Account / Deal are
connected as soon as the app registry is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class ValidationRulesConfig(AppConfig):
    """App config for ``validation_rules``."""

    name = "validation_rules"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Validation Rules"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        from . import signals  # noqa: F401
