"""Service layer for the events app.

* :func:`generate_ics` — produce an ICS calendar feed string for a user.
* :func:`detect_conflicts` — find events overlapping a [start, end] window.
* :func:`generate_conference_link` — stub that would call provider APIs.
* :func:`next_recurrence` — next occurrence of a recurring event.
* :func:`expand_recurrences` — all occurrences in a time window.
* :func:`send_event_notification` — best-effort reminder dispatch.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from dateutil import rrule as rrule_mod
from django.utils import timezone as dj_timezone
from icalendar import Calendar, Event as IcsEvent, vText

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

    from events.models import Event

log = logging.getLogger(__name__)


###############################################################################
# RRULE helpers
###############################################################################


def parse_rrule(rrule_str: str, dtstart: datetime | None = None) -> rrule_mod.rrule | None:
    """Parse an RFC 5545 RRULE string into a :class:`dateutil.rrule.rrule`."""
    if not rrule_str:
        return None
    try:
        cleaned = rrule_str.strip()
        if cleaned.upper().startswith("RRULE:"):
            cleaned = cleaned[len("RRULE:"):]
        return rrule_mod.rrulestr(f"RRULE:{cleaned}", dtstart=dtstart)
    except (ValueError, TypeError) as exc:
        log.warning("parse_rrule: invalid RRULE %r: %s", rrule_str, exc)
        return None


def next_recurrence(event: "Event", after: datetime | None = None) -> datetime | None:
    """Return the next occurrence datetime for a recurring event, or ``None``."""
    if not event.recurrence:
        return None
    base = after or event.start
    rule = parse_rrule(event.recurrence, dtstart=base)
    if rule is None:
        return None
    try:
        return rule.after(after or base, inc=False)  # type: ignore[arg-type]
    except (ValueError, TypeError) as exc:
        log.warning("next_recurrence: rule.after failed: %s", exc)
        return None


def expand_recurrences(
    event: "Event",
    *,
    start_window: datetime,
    end_window: datetime,
) -> list[datetime]:
    """Return all occurrence datetimes of ``event`` in ``[start_window, end_window]``."""
    rule = parse_rrule(event.recurrence, dtstart=event.start or start_window)
    if rule is None:
        return []
    return list(rule.between(start_window, end_window, inc=True))


###############################################################################
# Conflict detection
###############################################################################


def detect_conflicts(
    *,
    tenant: "Organization | None",
    user: "User",
    start: datetime,
    end: datetime,
    exclude_event_id: int | None = None,
) -> list["Event"]:
    """Return events the given ``user`` attends that overlap ``[start, end]``.

    An event overlaps when ``event.start < end`` AND ``event.end > start``.
    Cancelled events and all-day events are excluded from conflict detection
    (all-day events are typically blocking reminders, not hard conflicts).
    """
    from events.models import Event

    # Overlap window: event.start < end AND event.end > start. We split the
    # organizer-OR-attendee OR into two index-friendly subqueries and union
    # the resulting PK sets in Python.
    base_qs = Event.objects.filter(
        start__lt=end,
        end__gt=start,
        status=Event.STATUS_CONFIRMED,
        deleted_at__isnull=True,
    )
    organizer_ids = set(
        base_qs.filter(organizer=user).values_list("pk", flat=True)
    )
    attendee_ids = set(
        base_qs.filter(attendees=user).values_list("pk", flat=True)
    )
    conflict_ids = organizer_ids | attendee_ids
    if exclude_event_id is not None:
        conflict_ids.discard(exclude_event_id)
    if not conflict_ids:
        return []
    return list(Event.objects.filter(pk__in=conflict_ids).order_by("start"))


###############################################################################
# ICS export
###############################################################################


def generate_ics(
    *,
    tenant: "Organization | None",
    user: "User",
    window_days: int = 365,
) -> str:
    """Return an ICS calendar feed string of the user's events.

    Includes events the user organizes or attends, scheduled in the next
    ``window_days`` days. Each event is emitted as a VEVENT with DTSTART /
    DTEND / SUMMARY / DESCRIPTION / LOCATION and an RRULE line if recurring.
    """
    from events.models import Event

    now = dj_timezone.now()
    end_window = now + timedelta(days=window_days)

    qs = (
        Event.objects.filter(
            start__gte=now,
            start__lte=end_window,
            deleted_at__isnull=True,
            status__in=(Event.STATUS_CONFIRMED, Event.STATUS_TENTATIVE),
        )
        # We can't easily OR with .filter() in a single queryset without
        # Q objects, so do two queries and union in Python.
    )
    organizer_ids = set(qs.filter(organizer=user).values_list("pk", flat=True))
    attendee_ids = set(qs.filter(attendees=user).values_list("pk", flat=True))
    event_ids = organizer_ids | attendee_ids
    if not event_ids:
        return _empty_calendar()
    events = Event.objects.filter(pk__in=event_ids).order_by("start")

    calendar = Calendar()
    calendar.add("prodid", "-//Foundation//CRM//EN")
    calendar.add("version", "2.0")
    calendar.add("x-wr-calname", vText(f"Foundation — {user.email}"))

    for event in events.iterator(chunk_size=200):
        ics_event = IcsEvent()
        ics_event.add("uid", f"foundation-event-{event.pk}@foundation.local")
        ics_event.add("summary", event.title)
        if event.description:
            ics_event.add("description", event.description)
        if event.location:
            ics_event.add("location", event.location)
        ics_event.add("dtstart", event.start)
        ics_event.add("dtend", event.end)
        ics_event.add("dtstamp", dj_timezone.now())
        if event.organizer_id:
            ics_event.add(
                "organizer",
                f"mailto:{event.organizer.email}",
            )
        if event.conference_url:
            ics_event.add(
                "url",
                event.conference_url,
            )
        if event.recurrence:
            rule = parse_rrule(event.recurrence, dtstart=event.start)
            if rule is not None:
                ics_event.add("rrule", rule)
        calendar.add_component(ics_event)

    return calendar.to_ical().decode("utf-8")


def _empty_calendar() -> str:
    """Return an empty (but valid) ICS calendar string."""
    calendar = Calendar()
    calendar.add("prodid", "-//Foundation//CRM//EN")
    calendar.add("version", "2.0")
    return calendar.to_ical().decode("utf-8")


###############################################################################
# Conference-link stub
###############################################################################


#: Mapping of provider → stub URL template. In production these would be
#: replaced by calls to the provider's API (Google Calendar API, Zoom OAuth,
#: Microsoft Graph). The stub returns a deterministic placeholder URL so
#: end-to-end flows can be exercised in dev.
_CONFERENCE_STUB_TEMPLATES: dict[str, str] = {
    "google_meet": "https://meet.google.com/fnd-{event_id}",
    "zoom": "https://zoom.us/j/fnd{event_id}",
    "teams": "https://teams.microsoft.com/l/meetup-join/fnd-{event_id}",
    "none": "",
}


def generate_conference_link(provider: str, event: "Event") -> str:
    """Return a conference URL for ``event`` via ``provider``.

    This is a stub: it returns a deterministic placeholder URL keyed on the
    event's PK. In production this would call the provider's API
    (Google Calendar / Zoom / Microsoft Graph) to create the meeting and
    store the resulting URL on :attr:`Event.conference_url`.
    """
    if provider not in _CONFERENCE_STUB_TEMPLATES:
        raise ValueError(f"Unknown conference provider: {provider!r}")
    template = _CONFERENCE_STUB_TEMPLATES[provider]
    if not template:
        return ""
    return template.format(event_id=str(event.pk).zfill(8))


###############################################################################
# Notification dispatch
###############################################################################


def send_event_notification(
    *, user: "User", subject: str, body: str, event: "Event"
) -> dict[str, Any]:
    """Best-effort reminder dispatch for events.

    Returns a summary dict suitable for the Celery task audit trail. The
    actual delivery (email / push / in-app) is wired at deployment time.
    """
    log.info(
        "event_notification: user=%s event=%s subject=%r",
        user.pk, event.pk, subject,
    )
    return {
        "user_id": user.pk,
        "event_id": event.pk,
        "subject": subject,
        "body": body,
        "start": event.start.isoformat() if event.start else None,
    }
