"""Django app config for the calls module.

Imports :mod:`calls.signals` in :meth:`CallsConfig.ready` so the
``post_save`` receiver on :class:`calls.models.Call` is connected when the
app registry is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class CallsConfig(AppConfig):
    """App config for ``calls``."""

    name = "calls"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Calls"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        from . import signals  # noqa: F401
