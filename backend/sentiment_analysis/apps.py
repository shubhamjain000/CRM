"""Django app config for the sentiment_analysis module."""

from __future__ import annotations

from django.apps import AppConfig


class SentimentAnalysisConfig(AppConfig):
    """App config for ``sentiment_analysis``."""

    name = "sentiment_analysis"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Sentiment Analysis"
