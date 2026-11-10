"""Django app config for the ``crm_ux`` module.

Imports :mod:`crm_ux.signals` in :meth:`CrmUxConfig.ready` so the
``post_save`` receivers on ``Lead`` / ``Contact`` / ``Account`` / ``Deal``
are connected when the app registry is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class CrmUxConfig(AppConfig):
    """App config for ``crm_ux``."""

    name = "crm_ux"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "CRM UX"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the signals module connects the @receiver-decorated handlers.
        from . import signals  # noqa: F401
