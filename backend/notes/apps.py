"""Django app config for the notes module.

Imports :mod:`notes.signals` in :meth:`NotesConfig.ready` so the
``post_save`` receivers on :class:`notes.models.Note` (mention + hashtag
parsing, version snapshots) are connected when the app registry is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class NotesConfig(AppConfig):
    """App config for ``notes``."""

    name = "notes"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Notes"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the signals module connects the @receiver-decorated handlers.
        from . import signals  # noqa: F401
