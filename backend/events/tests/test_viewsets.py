"""ViewSet / API tests for the events app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from api.factories import UserFactory
from events.factories import EventFactory
from events.models import Event, EventAttendee, Meeting


pytestmark = pytest.mark.django_db


def test_list_events(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    EventFactory.create_batch(3)
    response = request_factory("GET", "/api/v1/events/")
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_create_event(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "title": "Quarterly review",
        "start": (timezone.now() + timedelta(days=2)).isoformat(),
        "end": (timezone.now() + timedelta(days=2, hours=1)).isoformat(),
        "location": "Boardroom",
        "conference_provider": "google_meet",
        "attendee_ids": [],
        "reminders": [{"offset_minutes": 30}],
    }
    response = request_factory("POST", "/api/v1/events/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["organizer"] == user.pk
    # Conference URL stub was generated.
    assert body["conference_url"].startswith("https://meet.google.com/fnd-")
    assert body["reminders"][0]["offset_minutes"] == 30
    assert body["reminders"][0]["sent"] is False


def test_create_event_rejects_end_before_start(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    start = timezone.now() + timedelta(days=1)
    end = start - timedelta(hours=1)
    payload = {
        "title": "Bad event",
        "start": start.isoformat(),
        "end": end.isoformat(),
    }
    response = request_factory("POST", "/api/v1/events/", payload, format="json")
    assert response.status_code == 400


def test_update_event(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/events/{event.pk}/",
        {"status": "tentative"},
        format="json",
    )
    assert response.status_code == 200
    event.refresh_from_db()
    assert event.status == "tentative"


def test_destroy_event_soft_deletes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    response = request_factory("DELETE", f"/api/v1/events/{event.pk}/")
    assert response.status_code == 204
    event.refresh_from_db()
    assert event.deleted_at is not None
    assert Event.objects.filter(pk=event.pk).count() == 0


def test_attendee_sync_on_create(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    other = UserFactory()
    payload = {
        "title": "Sync test",
        "start": (timezone.now() + timedelta(days=2)).isoformat(),
        "end": (timezone.now() + timedelta(days=2, hours=1)).isoformat(),
        "attendee_ids": [other.pk],
    }
    response = request_factory("POST", "/api/v1/events/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert len(body["attendees"]) == 1
    assert body["attendees"][0]["user"] == other.pk


def test_ics_export(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    EventFactory(title="My event", organizer=user)
    response = request_factory("GET", "/api/v1/events/ics-export/")
    assert response.status_code == 200
    body = response.content.decode("utf-8")
    assert "BEGIN:VCALENDAR" in body
    assert "My event" in body
    assert "END:VCALENDAR" in body


def test_detect_conflicts(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    # Existing event 10:00–11:00 tomorrow.
    start = timezone.now().replace(microsecond=0) + timedelta(days=1, hours=2)
    EventFactory(
        title="Existing",
        organizer=user,
        start=start,
        end=start + timedelta(hours=1),
    )
    # Conflict window overlapping 10:30–11:30.
    payload = {
        "start": (start + timedelta(minutes=30)).isoformat(),
        "end": (start + timedelta(minutes=90)).isoformat(),
    }
    response = request_factory("POST", "/api/v1/events/detect-conflicts/", payload, format="json")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["title"] == "Existing"


def test_detect_conflicts_exclude_self(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    start = timezone.now().replace(microsecond=0) + timedelta(days=1, hours=2)
    event = EventFactory(
        title="Existing",
        organizer=user,
        start=start,
        end=start + timedelta(hours=1),
    )
    payload = {
        "start": start.isoformat(),
        "end": (start + timedelta(hours=1)).isoformat(),
        "exclude_event_id": event.pk,
    }
    response = request_factory("POST", "/api/v1/events/detect-conflicts/", payload, format="json")
    assert response.status_code == 200
    assert response.json()["count"] == 0


def test_respond_creates_attendee(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    event = EventFactory()
    response = request_factory(
        "POST",
        f"/api/v1/events/{event.pk}/respond/",
        {"response": "yes"},
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["response"] == "yes"
    assert EventAttendee.objects.filter(event=event, user=user).count() == 1


def test_respond_updates_existing_attendee(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    event = EventFactory()
    EventAttendee.objects.create(event=event, user=user, response="no")
    response = request_factory(
        "POST",
        f"/api/v1/events/{event.pk}/respond/",
        {"response": "yes"},
        format="json",
    )
    assert response.status_code == 200
    link = EventAttendee.objects.get(event=event, user=user)
    assert link.response == "yes"
    assert link.responded_at is not None


def test_meeting_profile_lazy_create(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    response = request_factory("GET", f"/api/v1/events/{event.pk}/meeting/")
    assert response.status_code == 200
    assert Meeting.objects.filter(event=event).count() == 1
    assert response.json()["agenda"] == ""


def test_meeting_profile_patch(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/events/{event.pk}/meeting/",
        {"agenda": "Discuss Q3 roadmap", "action_items": [{"text": "Send recap", "done": False}]},
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["agenda"] == "Discuss Q3 roadmap"
    assert len(body["action_items"]) == 1


def test_filter_by_status(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    EventFactory.create_batch(2, status="confirmed")
    EventFactory.create_batch(1, status="tentative")
    response = request_factory("GET", "/api/v1/events/?status=tentative")
    assert response.status_code == 200
    assert response.json()["count"] == 1
