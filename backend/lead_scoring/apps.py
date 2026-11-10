"""Django app config for the lead_scoring module."""

from __future__ import annotations

from django.apps import AppConfig


class LeadScoringConfig(AppConfig):
    """App config for ``lead_scoring``."""

    name = "lead_scoring"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Lead Scoring"
