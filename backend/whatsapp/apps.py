"""Django app config for the whatsapp module."""

from __future__ import annotations

from django.apps import AppConfig


class WhatsAppConfig(AppConfig):
    """App config for ``whatsapp``."""

    name = "whatsapp"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "WhatsApp Business"
