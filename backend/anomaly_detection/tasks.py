"""Celery tasks for the anomaly_detection app.

The single task :func:`scan_anomalies_task` is dispatched hourly by the
``anomaly-scan`` Celery beat entry.
"""

from __future__ import annotations

import logging

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="anomaly_detection.scan_anomalies")
def scan_anomalies_task() -> dict[str, int]:
    """Hourly Celery-beat task — scan every tenant for CRM anomalies."""
    from .services import scan_anomalies  # noqa: PLC0415

    result = scan_anomalies()
    log.info("scan_anomalies: %s", result)
    return result


__all__ = ["scan_anomalies_task"]
