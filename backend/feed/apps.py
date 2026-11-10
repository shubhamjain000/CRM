"""Django app config for the ``feed`` module.

Imports :mod:`feed.signals` in :meth:`FeedConfig.ready` so the
``post_save`` receivers on :class:`FeedPost` and :class:`FeedComment`
(mention / hashtag parsing, activity logging, mention notifications) are
connected when the app registry is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class FeedConfig(AppConfig):
    """App config for ``feed``."""

    name = "feed"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Activity Feed"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the signals module connects the @receiver-decorated handlers.
        from . import signals  # noqa: F401
