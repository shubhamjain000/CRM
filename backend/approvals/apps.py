"""Django app config for the approvals module.

:meth:`ApprovalsConfig.ready` imports :mod:`approvals.signals` so the
``post_save`` receivers (approval-request notification fan-out on
:class:`ApprovalRequest` creation, activity log on
:class:`ApprovalAction` write) are connected as soon as the app registry
is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class ApprovalsConfig(AppConfig):
    """App config for ``approvals``."""

    name = "approvals"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Approvals"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the signals module connects the @receiver-decorated
        # ApprovalRequest / ApprovalAction post_save handlers.
        from . import signals  # noqa: F401
