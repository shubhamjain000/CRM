"""ViewSet / API tests for the calls app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from api.factories import UserFactory
from calls.factories import CallFactory
from calls.models import Call


pytestmark = pytest.mark.django_db


def test_list_calls(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    CallFactory.create_batch(3)
    response = request_factory("GET", "/api/v1/calls/")
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_create_call(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "subject": "Discovery call",
        "call_type": "outbound",
        "duration": 600,
        "outcome": "connected",
        "started_at": timezone.now().isoformat(),
        "ended_at": (timezone.now() + timedelta(minutes=10)).isoformat(),
        "attendee_ids": [],
    }
    response = request_factory("POST", "/api/v1/calls/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["created_by"] == user.pk
    assert body["call_type"] == "outbound"


def test_create_call_rejects_missed_with_duration(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = {
        "subject": "Bad missed call",
        "call_type": "missed",
        "duration": 30,
        "outcome": "no_answer",
        "started_at": timezone.now().isoformat(),
    }
    response = request_factory("POST", "/api/v1/calls/", payload, format="json")
    assert response.status_code == 400


def test_create_call_rejects_ended_before_started(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    started = timezone.now()
    payload = {
        "subject": "Time-travelling call",
        "call_type": "outbound",
        "duration": 10,
        "outcome": "connected",
        "started_at": started.isoformat(),
        "ended_at": (started - timedelta(minutes=1)).isoformat(),
    }
    response = request_factory("POST", "/api/v1/calls/", payload, format="json")
    assert response.status_code == 400


def test_update_call(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/calls/{call.pk}/",
        {"sentiment": "positive", "notes": "Great conversation."},
        format="json",
    )
    assert response.status_code == 200
    call.refresh_from_db()
    assert call.sentiment == "positive"
    assert call.notes == "Great conversation."


def test_destroy_call_soft_deletes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory()
    response = request_factory("DELETE", f"/api/v1/calls/{call.pk}/")
    assert response.status_code == 204
    call.refresh_from_db()
    assert call.deleted_at is not None
    assert Call.objects.filter(pk=call.pk).count() == 0


def test_log_call_quick_create(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "subject": "Quick logged call",
        "call_type": "outbound",
        "duration": 90,
        "outcome": "connected",
        "started_at": timezone.now().isoformat(),
        "related_module": "lead",
        "related_id": "42",
    }
    response = request_factory("POST", "/api/v1/calls/log-call/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["subject"] == "Quick logged call"
    assert body["related_module"] == "lead"
    assert body["related_id"] == "42"
    # Caller is auto-added as an attendee.
    assert any(a["id"] == user.pk for a in body["attendees"])


def test_log_call_with_explicit_attendees(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    other = UserFactory()
    payload = {
        "subject": "Two attendees",
        "started_at": timezone.now().isoformat(),
        "attendee_ids": [user.pk, other.pk],
    }
    response = request_factory("POST", "/api/v1/calls/log-call/", payload, format="json")
    assert response.status_code == 201
    body = response.json()
    assert len(body["attendees"]) == 2


def test_filter_by_call_type(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    CallFactory.create_batch(2, call_type="outbound")
    CallFactory.create_batch(1, call_type="inbound")
    response = request_factory("GET", "/api/v1/calls/?call_type=inbound")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_outcome(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    CallFactory.create_batch(2, outcome="connected")
    CallFactory.create_batch(1, outcome="voicemail")
    response = request_factory("GET", "/api/v1/calls/?outcome=voicemail")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_related_record(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    CallFactory(related_module="lead", related_id="42")
    CallFactory(related_module="contact", related_id="99")
    CallFactory(related_module="lead", related_id="43")
    response = request_factory("GET", "/api/v1/calls/?related_module=lead&related_id=42")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_sort_by_started_at(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    a = CallFactory(subject="Earlier", started_at=timezone.now() - timedelta(days=2))
    b = CallFactory(subject="Later", started_at=timezone.now() - timedelta(days=1))
    response = request_factory("GET", "/api/v1/calls/?sort=started_at")
    assert response.status_code == 200
    subjects = [r["subject"] for r in response.json()["results"]]
    assert subjects == [a.subject, b.subject]
