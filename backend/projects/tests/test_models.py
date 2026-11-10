"""Model-layer tests for the projects app."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from projects.models import (
    PRJ_ACTIVE,
    Project,
    ProjectTask,
    TASK_DEFAULT_STATUS,
    TimeEntry,
)


pytestmark = pytest.mark.django_db


def test_project_task_and_timeentry_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    project = Project.objects.create(
        tenant=active_tenant,
        name="Website Redesign",
        status=PRJ_ACTIVE,
        start_date=date(2024, 1, 1),
        end_date=date(2024, 3, 31),
        manager=user,
    )
    task = ProjectTask.objects.create(
        tenant=active_tenant,
        project=project,
        title="Design homepage",
        status=TASK_DEFAULT_STATUS,
        assignee=user,
        due_date=date(2024, 1, 31),
        estimated_hours=Decimal("10.00"),
        actual_hours=Decimal("8.00"),
    )
    entry = TimeEntry.objects.create(
        tenant=active_tenant,
        project=project,
        task=task,
        user=user,
        hours=Decimal("4.00"),
        date=date(2024, 1, 10),
        is_billable=True,
    )
    assert project.status == PRJ_ACTIVE
    assert task.status == TASK_DEFAULT_STATUS
    assert task.project_id == project.pk
    assert entry.task_id == task.pk
    assert entry.is_billable is True
    assert str(project) == "Project: Website Redesign"
    assert "Design homepage" in str(task)
