"""Model-level tests for the tasks app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.db import IntegrityError
from django.utils import timezone

from api.factories import OrganizationFactory
from api.managers import set_current_tenant, tenant_context
from tasks.factories import TaskFactory
from tasks.models import Task


pytestmark = pytest.mark.django_db


def test_task_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    assert task.pk is not None
    assert task.tenant_id == active_tenant.pk
    assert task.status == "not_started"
    assert task.priority == "medium"


def test_task_str(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory(title="Follow up with Ada")
    assert str(task) == "Follow up with Ada"


def test_soft_delete(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    task.soft_delete()
    assert Task.objects.filter(pk=task.pk).count() == 0
    assert Task.all_objects.filter(pk=task.pk).count() == 1


def test_check_constraint_rejects_invalid_priority(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory.build(priority="bogus")
    task.tenant = active_tenant
    with pytest.raises(IntegrityError):
        task.save()


def test_check_constraint_rejects_invalid_status(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory.build(status="bogus")
    task.tenant = active_tenant
    with pytest.raises(IntegrityError):
        task.save()


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        TaskFactory(title="Other")
    set_current_tenant(active_tenant)
    TaskFactory(title="Mine")
    titles = [t.title for t in Task.objects.all()]
    assert titles == ["Mine"]


def test_mark_complete_sets_completed_at(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    task.mark_complete()
    task.refresh_from_db()
    assert task.status == "completed"
    assert task.completed_at is not None
    assert task.last_activity is not None


def test_mark_deferred(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    task.mark_deferred()
    task.refresh_from_db()
    assert task.status == "deferred"


def test_touch_updates_last_activity(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory(last_activity=None)
    task.touch()
    task.refresh_from_db()
    assert task.last_activity is not None


def test_subtask_relationship(active_tenant):  # type: ignore[no-untyped-def]
    parent = TaskFactory()
    child = TaskFactory(parent_task=parent, title="Sub-item")
    assert child.parent_task_id == parent.pk
    assert list(parent.subtasks.all()) == [child]


def test_reminder_idempotent_via_mark_reminded(active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory(reminder=timezone.now() - timedelta(minutes=5))
    task.mark_reminded()
    task.refresh_from_db()
    assert task.reminder_sent_at is not None
