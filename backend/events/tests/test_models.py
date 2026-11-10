"""Model-level tests for the events app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.db import IntegrityError
from django.utils import timezone

from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from events.factories import EventAttendeeFactory, EventFactory, MeetingFactory
from events.models import Event, EventAttendee, Meeting


pytestmark = pytest.mark.django_db


def test_event_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    assert event.pk is not None
    assert event.tenant_id == active_tenant.pk
    assert event.status == "confirmed"


def test_event_str(active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory(title="Weekly standup")
    assert "Weekly standup" in str(event)


def test_event_end_before_start_rejected(active_tenant):  # type: ignore[no-untyped-def]
    start = timezone.now()
    end = start - timedelta(hours=1)
    event = EventFactory.build(start=start, end=end)
    event.tenant = active_tenant
    with pytest.raises(IntegrityError):
        event.save()


def test_check_constraint_rejects_invalid_status(active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory.build(status="bogus")
    event.tenant = active_tenant
    with pytest.raises(IntegrityError):
        event.save()


def test_check_constraint_rejects_invalid_visibility(active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory.build(visibility="bogus")
    event.tenant = active_tenant
    with pytest.raises(IntegrityError):
        event.save()


def test_soft_delete(active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    event.soft_delete()
    assert Event.objects.filter(pk=event.pk).count() == 0
    assert Event.all_objects.filter(pk=event.pk).count() == 1


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        EventFactory(title="Other")
    set_current_tenant(active_tenant)
    EventFactory(title="Mine")
    titles = [e.title for e in Event.objects.all()]
    assert titles == ["Mine"]


def test_event_attendee_through_model(active_tenant, user):  # type: ignore[no-untyped-def]
    event = EventFactory()
    other = UserFactory()
    a1 = EventAttendeeFactory(event=event, user=user, response="yes")
    a2 = EventAttendeeFactory(event=event, user=other, response="no")
    assert set(event.attendees.all()) == {user, other}
    assert a1.response == "yes"
    assert a2.response == "no"


def test_event_attendee_unique_per_event_user(active_tenant, user):  # type: ignore[no-untyped-def]
    event = EventFactory()
    EventAttendeeFactory(event=event, user=user)
    with pytest.raises(IntegrityError):
        EventAttendeeFactory(event=event, user=user)


def test_event_attendee_mark_response(active_tenant, user):  # type: ignore[no-untyped-def]
    event = EventFactory()
    link = EventAttendeeFactory(event=event, user=user, response="none")
    link.mark_response("maybe")
    link.refresh_from_db()
    assert link.response == "maybe"
    assert link.responded_at is not None


def test_meeting_profile_one_to_one(active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    meeting = MeetingFactory(event=event)
    assert meeting.event_id == event.pk
    # Re-creating via get_or_create is idempotent.
    meeting2, created = Meeting.objects.get_or_create(event=event)
    assert created is False
    assert meeting2.pk == meeting.pk


def test_meeting_engagement_score_range(active_tenant):  # type: ignore[no-untyped-def]
    event = EventFactory()
    meeting = MeetingFactory.build(event=event, engagement_score=150.0)
    with pytest.raises(IntegrityError):
        meeting.save()
