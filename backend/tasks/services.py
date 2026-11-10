"""Service layer for the tasks app.

These helpers keep the viewsets / Celery tasks thin and make the business
logic testable without an HTTP layer.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any

from dateutil import rrule as rrule_mod

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

    from tasks.models import Task

log = logging.getLogger(__name__)

#: How far ahead the recurring-task generator looks for the next instance.
RECURRENCE_HORIZON_DAYS = 365


def parse_rrule(rrule_str: str, dtstart: datetime | None = None) -> rrule_mod.rrule | None:
    """Parse an RFC 5545 RRULE string into a :class:`dateutil.rrule.rrule`.

    Returns ``None`` if the string is empty or unparseable. ``dtstart`` defaults
    to the task's due_date (or now() if unset) at the call site.
    """
    if not rrule_str:
        return None
    try:
        # Accept either "RRULE:FREQ=..." or "FREQ=...".
        cleaned = rrule_str.strip()
        if cleaned.upper().startswith("RRULE:"):
            cleaned = cleaned[len("RRULE:"):]
        return rrule_mod.rrulestr(f"RRULE:{cleaned}", dtstart=dtstart)
    except (ValueError, TypeError) as exc:
        log.warning("parse_rrule: invalid RRULE %r: %s", rrule_str, exc)
        return None


def next_recurrence(task: "Task", after: datetime | None = None) -> datetime | None:
    """Return the next occurrence datetime for a recurring task, or ``None``.

    ``after`` defaults to ``task.due_date`` (or now if unset). Returns ``None``
    for one-off tasks or when the RRULE is unparseable.
    """
    if not task.recurrence:
        return None
    base = after or task.due_date
    rule = parse_rrule(task.recurrence, dtstart=base)
    if rule is None:
        return None
    # ``after`` is exclusive: we want the next occurrence strictly later than it.
    try:
        return rule.after(after or base, inc=False)  # type: ignore[arg-type]
    except (ValueError, TypeError) as exc:
        log.warning("next_recurrence: rule.after failed: %s", exc)
        return None


def expand_recurrences(
    task: "Task",
    *,
    start_window: datetime,
    end_window: datetime,
) -> list[datetime]:
    """Return all occurrence datetimes of ``task`` in ``[start_window, end_window]``."""
    rule = parse_rrule(task.recurrence, dtstart=task.due_date or start_window)
    if rule is None:
        return []
    return list(rule.between(start_window, end_window, inc=True))


def send_task_notification(
    *, user: "User", subject: str, body: str, task: "Task"
) -> dict[str, Any]:
    """Best-effort notification dispatch for task reminders.

    This is a stub that logs the notification and would integrate with the
    notification center / email dispatcher in a real deployment. Returns a
    summary dict suitable for the Celery task audit trail.
    """
    log.info(
        "task_notification: user=%s task=%s subject=%r",
        user.pk, task.pk, subject,
    )
    return {
        "user_id": user.pk,
        "task_id": task.pk,
        "subject": subject,
        "body": body,
        "sent_at": task.reminder_sent_at.isoformat() if task.reminder_sent_at else None,
    }
