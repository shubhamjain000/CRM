"""Django app config for the invoicing module."""

from __future__ import annotations

from django.apps import AppConfig


class InvoicingConfig(AppConfig):
    """App config for ``invoicing``."""

    name = "invoicing"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Invoicing"
