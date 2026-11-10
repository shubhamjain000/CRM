"""Celery tasks for the blueprint app.

One beat-scheduled task (see ``config/settings.py``):

* :func:`run_blueprint_timers` — hourly. Wraps
  :meth:`blueprint.services.BlueprintService.check_timers` so the timer
  sweep runs on a worker rather than on the request path.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="blueprint.run_blueprint_timers")
def run_blueprint_timers() -> dict[str, Any]:
    """Hourly Celery beat — fire every due :class:`blueprint.models.BlueprintTimer`.

    Delegates to :meth:`blueprint.services.BlueprintService.check_timers`.
    Failures are caught + logged inside the service so the beat task never
    re-raises into the worker.
    """
    from blueprint.services import BlueprintService

    try:
        return BlueprintService().check_timers()
    except Exception as exc:  # pragma: no cover — defensive
        log.exception("run_blueprint_timers: failed")
        return {"error": str(exc)}


__all__ = ["run_blueprint_timers"]
