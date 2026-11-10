"""Celery tasks for the lead_scoring app.

The single task :func:`score_all_leads_task` is dispatched by the daily
2am Celery beat entry ``lead-score-all`` (see
:data:`config.settings.CELERY_BEAT_SCHEDULE`).
"""

from __future__ import annotations

import logging

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="lead_scoring.score_all_leads")
def score_all_leads_task() -> dict[str, int]:
    """Daily Celery-beat task — re-score every Lead in every tenant."""
    from .services import score_all_leads  # noqa: PLC0415

    result = score_all_leads()
    log.info("score_all_leads: %s", result)
    return result


__all__ = ["score_all_leads_task"]
