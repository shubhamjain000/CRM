"""Django app config for the forecasting module."""

from __future__ import annotations

from django.apps import AppConfig


class ForecastingConfig(AppConfig):
    """App config for ``forecasting``."""

    name = "forecasting"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Forecasting"
