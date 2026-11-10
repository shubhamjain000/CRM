"""Django app config for the deals module.

Phase 8 wires :mod:`deals.alerts` in :meth:`DealsConfig.ready` so the
``pre_save`` / ``post_save`` receivers on :class:`deals.models.Deal`
(amount-drop detection) are connected as soon as the app registry is
ready.
"""

from django.apps import AppConfig


class DealsConfig(AppConfig):
    name = "deals"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Deals"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the alerts module connects the @receiver-decorated
        # signal handlers (deal amount-drop detection) and registers the
        # Celery tasks (``deals.check_stuck_deals``,
        # ``deals.check_overdue_deals``) with the shared-task registry.
        from . import alerts  # noqa: F401
