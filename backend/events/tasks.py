"""Celery tasks for the events app.

Two beat-scheduled tasks (see ``config/settings.py``):

* :func:`send_event_reminders` — every 5 minutes. Scans every event's
  ``reminders`` list, and for each reminder whose ``offset_minutes`` has
  elapsed (``event.start - now >= offset_minutes``) and whose ``sent`` flag is
  ``False``, dispatches a notification and flips ``sent`` to ``True``.
* :func:`generate_recurring_events` — daily at 03:30 UTC. Advances recurring
  events by cloning the current instance (as a one-off) and stamping the
  original's ``start`` / ``end`` to the next occurrence.

Both tasks iterate per-tenant via :func:`api.managers.tenant_context` so the
ORM tenant scoping is correct.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from api.managers import tenant_context
from api.models import Organization

from .models import Event
from .services import next_recurrence, send_event_notification

log = logging.getLogger(__name__)


###############################################################################
# Event reminders
###############################################################################


@shared_task(name="events.send_event_reminders")
def send_event_reminders() -> dict[str, Any]:
    """Dispatch event reminders whose offset has elapsed.

    For each event with a ``reminders`` list, find items where:

    * ``sent`` is False, AND
    * ``event.start - now >= timedelta(minutes=offset_minutes)`` (i.e. the
      reminder time has arrived).

    Dispatch a notification, then flip ``sent`` to True on the matching
    reminder entry. The mutation is atomic per event.
    """
    now = timezone.now()
    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "reminders_sent": 0,
        "errors": [],
    }

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            upcoming = (
                Event.objects.filter(
                    deleted_at__isnull=True,
                    status__in=(Event.STATUS_CONFIRMED, Event.STATUS_TENTATIVE),
                    start__gte=now - timedelta(days=1),
                    start__lte=now + timedelta(days=7),
                )
                .exclude(reminders=[])
                .select_related("organizer")
                .iterator(chunk_size=200)
            )
            for event in upcoming:
                try:
                    sent_count = _dispatch_reminders_for_event(event, now)
                    summary["reminders_sent"] += sent_count
                except Exception as exc:  # pragma: no cover — defensive
                    log.exception("send_event_reminders: failed on event %s", event.pk)
                    summary["errors"].append({"event_id": event.pk, "error": str(exc)})

    log.info(
        "send_event_reminders: tenants=%s sent=%s",
        summary["tenants_processed"], summary["reminders_sent"],
    )
    return summary


def _dispatch_reminders_for_event(event: Event, now: Any) -> int:
    """Dispatch all due reminders on ``event``. Returns the count dispatched."""
    reminders = list(event.reminders or [])
    if not reminders:
        return 0
    dispatched = 0
    changed = False
    for spec in reminders:
        if not isinstance(spec, dict):
            continue
        if spec.get("sent"):
            continue
        offset_minutes = spec.get("offset_minutes")
        if offset_minutes is None:
            continue
        try:
            offset = timedelta(minutes=int(offset_minutes))
        except (TypeError, ValueError):
            continue
        if event.start - offset > now:
            continue  # not yet time
        # Dispatch.
        send_event_notification(
            user=event.organizer,
            subject=f"Event reminder: {event.title}",
            body=event.description or event.title,
            event=event,
        )
        spec["sent"] = True
        changed = True
        dispatched += 1
        # Also notify each attendee.
        for attendee in event.attendees.all():
            send_event_notification(
                user=attendee,
                subject=f"Event reminder: {event.title}",
                body=event.description or event.title,
                event=event,
            )
    if changed:
        event.reminders = reminders
        event.save(update_fields=["reminders", "updated_at"])
    return dispatched


###############################################################################
# Recurring-event generation
###############################################################################


@shared_task(name="events.generate_recurring_events")
def generate_recurring_events() -> dict[str, Any]:
    """Advance recurring events to their next occurrence.

    For every recurring event whose ``start`` has passed (or is today), we:

    1. Compute the next occurrence datetime via
       :func:`events.services.next_recurrence`.
    2. Clone the event as a one-off (``recurrence=""``) at the *current* start
       so the historical instance is preserved.
    3. Advance the original event's ``start`` / ``end`` to the next occurrence
       (preserving the duration).

    Idempotent across re-runs on the same day: the next-occurrence check is
    strictly greater than ``now()``, so an event already advanced today will
    not be advanced again until its new start time passes.
    """
    now = timezone.now()
    today_end = now.replace(hour=23, minute=59, second=59, microsecond=0)
    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "advanced": 0,
        "cloned": 0,
        "errors": [],
    }

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            recurring = (
                Event.objects.filter(
                    ~Q(recurrence=""),
                    deleted_at__isnull=True,
                )
                .iterator(chunk_size=200)
            )
            for event in recurring:
                try:
                    start = event.start
                    if start > today_end:
                        continue  # not yet due today
                    nxt = next_recurrence(event, after=start)
                    if nxt is None:
                        continue
                    delta = nxt - start
                    with transaction.atomic():
                        Event.objects.create(
                            tenant=event.tenant,
                            title=event.title,
                            description=event.description,
                            start=event.start,
                            end=event.end,
                            all_day=event.all_day,
                            location=event.location,
                            external_attendees=event.external_attendees,
                            recurrence="",
                            reminders=event.reminders,
                            conference_url=event.conference_url,
                            conference_provider=event.conference_provider,
                            related_module=event.related_module,
                            related_id=event.related_id,
                            status=event.status,
                            organizer=event.organizer,
                            visibility=event.visibility,
                        )
                        # Advance the original event.
                        event.start = nxt
                        event.end = event.end + delta
                        event.last_expanded_at = now
                        # Reset reminder sent flags.
                        reminders = list(event.reminders or [])
                        for spec in reminders:
                            if isinstance(spec, dict):
                                spec["sent"] = False
                        event.reminders = reminders
                        event.save(update_fields=[
                            "start",
                            "end",
                            "last_expanded_at",
                            "reminders",
                            "updated_at",
                        ])
                    summary["advanced"] += 1
                    summary["cloned"] += 1
                except Exception as exc:  # pragma: no cover — defensive
                    log.exception("generate_recurring_events: failed on event %s", event.pk)
                    summary["errors"].append({"event_id": event.pk, "error": str(exc)})

    log.info(
        "generate_recurring_events: tenants=%s advanced=%s cloned=%s",
        summary["tenants_processed"], summary["advanced"], summary["cloned"],
    )
    return summary
