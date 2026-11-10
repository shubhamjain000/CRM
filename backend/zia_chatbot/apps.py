"""Django app config for the zia_chatbot module."""

from __future__ import annotations

from django.apps import AppConfig


class ZiaChatbotConfig(AppConfig):
    """App config for ``zia_chatbot``."""

    name = "zia_chatbot"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Zia Chatbot"
