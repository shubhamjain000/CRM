"""Celery tasks for the telephony app.

* :func:`transcribe_call_task` — async transcription of a single call
  recording via :func:`telephony.services.transcribe_call`.
* :func:`send_bulk_sms_task` — rate-limited bulk send wrapper around
  :func:`telephony.services.send_bulk_sms`.
* :func:`cleanup_old_recordings` — daily beat, deletes recording URLs
  older than the retention period (default 90 days).
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.utils import timezone

from .models import TelephonyCall
from .services import (
    get_call_analytics,
    send_bulk_sms,
    transcribe_call,
)

log = logging.getLogger(__name__)

# Default recording retention (days). Override by passing ``retention_days``
# to :func:`cleanup_old_recordings` or via the beat schedule kwargs.
DEFAULT_RECORDING_RETENTION_DAYS = 90


@shared_task(name="telephony.transcribe_call_task")
def transcribe_call_task(call_id: int) -> dict[str, Any]:
    """Transcribe the recording attached to ``call_id``."""
    call = transcribe_call(call_id)
    return {
        "call_id": call.pk,
        "transcription_chars": len(call.transcription or ""),
        "sentiment": call.sentiment,
    }


@shared_task(name="telephony.send_bulk_sms_task")
def send_bulk_sms_task(
    template_id: int,
    recipients: list[dict[str, Any]],
    from_number: str,
    tenant_id: int | None = None,
    rate_per_sec: int = 10,
) -> dict[str, int]:
    """Async wrapper around :func:`telephony.services.send_bulk_sms`."""
    from api.models import Organization  # noqa: PLC0415 — lazy import

    tenant = Organization.objects.filter(pk=tenant_id).first() if tenant_id else None
    return send_bulk_sms(
        template_id=template_id,
        recipients=recipients,
        from_number=from_number,
        tenant=tenant,
        rate_per_sec=rate_per_sec,
    )


@shared_task(name="telephony.cleanup_old_recordings")
def cleanup_old_recordings(retention_days: int = DEFAULT_RECORDING_RETENTION_DAYS) -> dict[str, int]:
    """Clear ``recording_url`` on calls older than ``retention_days``.

    The call row itself is preserved (audit / analytics); only the
    recording URL is wiped so the S3 bucket can be lifecycle-policy'd.
    """
    cutoff = timezone.now() - timedelta(days=retention_days)
    qs = TelephonyCall.objects.exclude(recording_url="").filter(started_at__lt=cutoff)
    cleared = 0
    for call in qs.iterator():
        call.recording_url = ""
        call.save(update_fields=["recording_url", "updated_at"])
        cleared += 1
    return {"cleared": cleared}


@shared_task(name="telephony.daily_analytics_snapshot")
def daily_analytics_snapshot() -> dict[str, Any]:
    """Daily snapshot of yesterday's call analytics (stub).

    Production writes the result to the analytics warehouse.
    """
    today = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today - timedelta(days=1)
    return get_call_analytics(
        {"started_at__gte": yesterday_start, "started_at__lt": today}
    )
