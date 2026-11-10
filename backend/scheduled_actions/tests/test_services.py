"""Service-layer tests for the scheduled_actions app.

Covers :class:`scheduled_actions.services.ScheduledActionsService`:
* ``compute_next_run`` — cron parsing + timezone handling.
* ``run_due_jobs`` — dispatches due jobs, recomputes next_run_at.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from scheduled_actions.factories import ScheduledJobFactory
from scheduled_actions.models import ScheduledJobLog
from scheduled_actions.services import ScheduledActionsService


pytestmark = pytest.mark.django_db


def test_compute_next_run_returns_future_datetime(active_tenant, user):  # type: ignore[no-untyped-def]
    service = ScheduledActionsService()
    now = timezone.now()
    next_run = service.compute_next_run("0 9 * * *", "UTC", after=now)
    assert next_run > now


def test_compute_next_run_handles_invalid_timezone(active_tenant, user):  # type: ignore[no-untyped-def]
    service = ScheduledActionsService()
    now = timezone.now()
    next_run = service.compute_next_run("0 9 * * *", "Not/A/Real/Tz", after=now)
    assert next_run > now


def test_run_due_jobs_dispatches_past_due_job(active_tenant, user):  # type: ignore[no-untyped-def]
    """A job with next_run_at in the past should be dispatched + rescheduled."""
    job = ScheduledJobFactory(
        tenant=active_tenant,
        action_type="notify_team",
        config={"title": "Scheduled", "body": "Run", "team_id": None},
        next_run_at=timezone.now() - timedelta(minutes=5),
    )
    summary = ScheduledActionsService().run_due_jobs()
    assert summary["checked"] >= 1
    job.refresh_from_db()
    assert job.last_run_at is not None
    assert job.next_run_at is not None
    assert job.next_run_at > timezone.now()
    assert ScheduledJobLog.objects.filter(job=job).exists()


def test_run_due_jobs_skips_paused_job(active_tenant, user):  # type: ignore[no-untyped-def]
    job = ScheduledJobFactory(
        tenant=active_tenant,
        status="paused",
        next_run_at=timezone.now() - timedelta(minutes=5),
    )
    ScheduledActionsService().run_due_jobs()
    job.refresh_from_db()
    assert job.last_run_at is None
    assert not ScheduledJobLog.objects.filter(job=job).exists()
