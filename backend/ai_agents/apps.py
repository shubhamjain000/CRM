"""Django app config for the ai_agents module."""

from __future__ import annotations

from django.apps import AppConfig


class AIAgentsConfig(AppConfig):
    """App config for ``ai_agents``."""

    name = "ai_agents"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "AI Agents"
