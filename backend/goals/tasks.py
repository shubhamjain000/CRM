"""Celery tasks for the goals app.

The single task :func:`refresh_all_goals_task` is dispatched by the
daily 1am Celery beat entry (see
:data:`config.settings.CELERY_BEAT_SCHEDULE` ``goals-refresh-all``). It
re-runs :func:`goals.services.refresh_all_goals` across every tenant.
"""

from __future__ import annotations

import logging

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="goals.refresh_all_goals")
def refresh_all_goals_task() -> dict[str, int]:
    """Daily Celery-beat task — refresh ``actual_amount`` on every active goal."""
    from goals.services import refresh_all_goals  # noqa: PLC0415

    result = refresh_all_goals()
    log.info("refresh_all_goals: %s", result)
    return result


__all__ = ["refresh_all_goals_task"]
