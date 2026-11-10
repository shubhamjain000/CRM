"""Django app config for the custom_fields module.

Wires the ``post_save`` signal on :class:`custom_fields.models.CustomField`
that enqueues the backfill task.
"""

from django.apps import AppConfig


class CustomFieldsConfig(AppConfig):
    name = "custom_fields"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Custom Fields"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the signals module connects the receivers.
        from . import signals  # noqa: F401
