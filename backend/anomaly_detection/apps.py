"""Django app config for the anomaly_detection module."""

from __future__ import annotations

from django.apps import AppConfig


class AnomalyDetectionConfig(AppConfig):
    """App config for ``anomaly_detection``."""

    name = "anomaly_detection"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Anomaly Detection"
