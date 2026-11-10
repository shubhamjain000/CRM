"""ViewSet / API tests for the tasks app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from tasks.factories import TaskFactory
from tasks.models import Task


pytestmark = pytest.mark.django_db


def test_list_tasks(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    TaskFactory.create_batch(3)
    response = request_factory("GET", "/api/v1/tasks/")
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_create_task(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "title": "Follow up with Ada",
        "priority": "high",
        "due_date": (timezone.now() + timedelta(days=2)).isoformat(),
        "tags": ["Phase-5", "phase-5", "  Phase-5  "],
        "checklist": [{"text": "Draft email", "done": False}],
    }
    response = request_factory("POST", "/api/v1/tasks/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    # Tags are normalized (lowercased + de-duplicated).
    assert body["tags"] == ["phase-5"]
    assert len(body["checklist"]) == 1
    assert body["owner"] == user.pk
    assert body["created_by"] == user.pk
    assert body["assignee"] == user.pk  # defaults to owner


def test_create_task_rejects_empty_checklist_text(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = {
        "title": "Bad task",
        "checklist": [{"text": "", "done": False}],
    }
    response = request_factory("POST", "/api/v1/tasks/", payload, format="json")
    assert response.status_code == 400


def test_create_task_rejects_reminder_after_due_date(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = {
        "title": "Time-travelling task",
        "due_date": (timezone.now() + timedelta(days=1)).isoformat(),
        "reminder": (timezone.now() + timedelta(days=2)).isoformat(),
    }
    response = request_factory("POST", "/api/v1/tasks/", payload, format="json")
    assert response.status_code == 400


def test_update_task(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/tasks/{task.pk}/",
        {"status": "in_progress", "priority": "urgent"},
        format="json",
    )
    assert response.status_code == 200
    task.refresh_from_db()
    assert task.status == "in_progress"
    assert task.priority == "urgent"


def test_destroy_task_soft_deletes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    response = request_factory("DELETE", f"/api/v1/tasks/{task.pk}/")
    assert response.status_code == 204
    task.refresh_from_db()
    assert task.deleted_at is not None
    assert Task.objects.filter(pk=task.pk).count() == 0


def test_complete_action(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory(status="not_started")
    response = request_factory("POST", f"/api/v1/tasks/{task.pk}/complete/")
    assert response.status_code == 200
    task.refresh_from_db()
    assert task.status == "completed"
    assert task.completed_at is not None


def test_defer_action(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory(status="not_started")
    response = request_factory("POST", f"/api/v1/tasks/{task.pk}/defer/")
    assert response.status_code == 200
    task.refresh_from_db()
    assert task.status == "deferred"


def test_add_subtask_action(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    parent = TaskFactory()
    response = request_factory(
        "POST",
        f"/api/v1/tasks/{parent.pk}/add-subtask/",
        {"title": "First step"},
        format="json",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["parent_task"] == parent.pk
    assert body["title"] == "First step"
    parent.refresh_from_db()
    assert parent.subtasks.count() == 1


def test_start_and_stop_timer(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory(time_spent=0)
    start = request_factory("POST", f"/api/v1/tasks/{task.pk}/start-timer/")
    assert start.status_code == 200
    task.refresh_from_db()
    assert task.timer_started_at is not None
    assert task.status == "in_progress"

    stop = request_factory("POST", f"/api/v1/tasks/{task.pk}/stop-timer/")
    assert stop.status_code == 200
    task.refresh_from_db()
    assert task.timer_started_at is None
    assert task.time_spent >= 0  # at least stamped


def test_start_timer_idempotent(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    request_factory("POST", f"/api/v1/tasks/{task.pk}/start-timer/")
    second = request_factory("POST", f"/api/v1/tasks/{task.pk}/start-timer/")
    assert second.status_code == 409


def test_bulk_update(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    tasks = TaskFactory.create_batch(2, status="not_started")
    ids = [t.pk for t in tasks]
    response = request_factory(
        "POST",
        "/api/v1/tasks/bulk-update/",
        {"ids": ids, "fields": {"status": "in_progress"}},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 2
    for t in tasks:
        t.refresh_from_db()
        assert t.status == "in_progress"


def test_bulk_update_rejects_disallowed_field(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    task = TaskFactory()
    response = request_factory(
        "POST",
        "/api/v1/tasks/bulk-update/",
        {"ids": [task.pk], "fields": {"title": "Hacked"}},
        format="json",
    )
    assert response.status_code == 400


def test_filter_by_status(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    TaskFactory.create_batch(2, status="not_started")
    TaskFactory.create_batch(1, status="completed")
    response = request_factory("GET", "/api/v1/tasks/?status=completed")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_tag(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    TaskFactory(tags=["urgent", "phase-5"])
    TaskFactory(tags=["low-priority"])
    response = request_factory("GET", "/api/v1/tasks/?tag=phase-5")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_sort_by_due_date(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    a = TaskFactory(due_date=timezone.now() + timedelta(days=5))
    b = TaskFactory(due_date=timezone.now() + timedelta(days=1))
    response = request_factory("GET", "/api/v1/tasks/?sort=due_date")
    assert response.status_code == 200
    titles = [r["title"] for r in response.json()["results"]]
    # Ascending sort → b (earlier) before a (later).
    assert titles == [b.title, a.title]
