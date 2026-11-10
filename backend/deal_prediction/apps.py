"""Django app config for the deal_prediction module."""

from __future__ import annotations

from django.apps import AppConfig


class DealPredictionConfig(AppConfig):
    """App config for ``deal_prediction``."""

    name = "deal_prediction"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Deal Prediction"
