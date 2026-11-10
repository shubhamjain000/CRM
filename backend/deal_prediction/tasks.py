"""Celery tasks for the deal_prediction app.

The single task :func:`predict_all_deals_task` is dispatched by the daily
2:30am Celery beat entry ``deal-predict-all``.
"""

from __future__ import annotations

import logging

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="deal_prediction.predict_all_deals")
def predict_all_deals_task() -> dict[str, int]:
    """Daily Celery-beat task — re-predict every Deal in every tenant."""
    from .services import predict_all_deals  # noqa: PLC0415

    result = predict_all_deals()
    log.info("predict_all_deals: %s", result)
    return result


__all__ = ["predict_all_deals_task"]
