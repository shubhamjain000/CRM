"""Celery tasks for the unified inbox app."""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

from .services import check_sla_breaches

log = logging.getLogger(__name__)


@shared_task(name="inbox.check_sla_breaches")
def check_sla_breaches_task() -> dict[str, Any]:
    """Beat task — sweep open conversations for SLA breaches every 5 min.

    Returns counts of response-SLA and resolution-SLA breaches. The
    notifications app dispatches the actual alerts (TODO: write
    breach audit rows or push notification triggers based on these
    counts).
    """
    result = check_sla_breaches()
    if result["response_breaches"] or result["resolution_breaches"]:
        log.warning(
            "inbox.check_sla_breaches_task: %d response, %d resolution breaches",
            result["response_breaches"],
            result["resolution_breaches"],
        )
    return result
