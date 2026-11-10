"""ViewSet / API tests for the scheduled_actions app."""

from __future__ import annotations

import pytest

from scheduled_actions.factories import ScheduledJobFactory
from scheduled_actions.models import ScheduledJob


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def grant_scheduled_actions_permissions(admin_role):  # type: ignore[no-untyped-def]
    """Grant ``scheduled_actions.manage`` to the admin role."""
    if "scheduled_actions.manage" not in (admin_role.permissions or []):
        admin_role.permissions = list(admin_role.permissions or []) + [
            "scheduled_actions.manage"
        ]
        admin_role.save(update_fields=["permissions"])
    return admin_role


###############################################################################
# ScheduledJobViewSet
###############################################################################


def test_list_scheduled_jobs(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ScheduledJobFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/scheduled-jobs/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_scheduled_job_stamps_next_run_at(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST",
        "/api/v1/scheduled-jobs/",
        {
            "name": "Daily digest",
            "cron_expression": "0 9 * * *",
            "action_type": "notify_team",
            "config": {"title": "Daily", "body": "digest"},
            "status": "active",
            "timezone": "UTC",
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Daily digest"
    assert body["next_run_at"] is not None


def test_pause_and_resume_job(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    job = ScheduledJobFactory(tenant=active_tenant, status="active")
    response = request_factory("POST", f"/api/v1/scheduled-jobs/{job.pk}/pause/")
    assert response.status_code == 200, response.content
    job.refresh_from_db()
    assert job.status == "paused"
    response = request_factory("POST", f"/api/v1/scheduled-jobs/{job.pk}/resume/")
    assert response.status_code == 200, response.content
    job.refresh_from_db()
    assert job.status == "active"
    assert job.next_run_at is not None


def test_destroy_scheduled_job(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    job = ScheduledJobFactory(tenant=active_tenant)
    response = request_factory("DELETE", f"/api/v1/scheduled-jobs/{job.pk}/")
    assert response.status_code == 204, response.content
    assert not ScheduledJob.objects.filter(pk=job.pk).exists()


def test_run_now_dispatches_job(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    job = ScheduledJobFactory(
        tenant=active_tenant,
        action_type="notify_team",
        config={"title": "Run", "body": "now", "team_id": None},
    )
    response = request_factory("POST", f"/api/v1/scheduled-jobs/{job.pk}/run-now/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["job"] == job.pk
    assert body["status"] in ("success", "failed")
