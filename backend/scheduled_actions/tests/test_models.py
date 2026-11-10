"""Model-layer tests for the scheduled_actions app."""

from __future__ import annotations

import pytest

from scheduled_actions.factories import (
    ScheduledJobFactory,
    ScheduledJobLogFactory,
)
from scheduled_actions.models import ScheduledJob


pytestmark = pytest.mark.django_db


def test_scheduled_job_str(active_tenant, user):  # type: ignore[no-untyped-def]
    job = ScheduledJobFactory(tenant=active_tenant, name="Daily digest", cron_expression="0 9 * * *")
    text = str(job)
    assert "Daily digest" in text
    assert "0 9 * * *" in text


def test_scheduled_job_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    job = ScheduledJobFactory(tenant=active_tenant)
    assert job.status == "active"
    assert job.cron_expression == "* * * * *"
    assert job.timezone == "UTC"
    assert job.action_type == "notify_team"


def test_scheduled_job_log_str(active_tenant, user):  # type: ignore[no-untyped-def]
    log_row = ScheduledJobLogFactory(
        tenant=active_tenant, status="success"
    )
    text = str(log_row)
    assert "success" in text


def test_scheduled_job_query_filters_by_status(active_tenant, user):  # type: ignore[no-untyped-def]
    ScheduledJobFactory.create_batch(2, tenant=active_tenant, status="active")
    ScheduledJobFactory(tenant=active_tenant, status="paused")
    assert ScheduledJob.objects.filter(status="active").count() == 2
    assert ScheduledJob.objects.filter(status="paused").count() == 1
