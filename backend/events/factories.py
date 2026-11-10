"""factory_boy factories for the events app."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from factory import LazyFunction, SubFactory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from events.models import Event, EventAttendee, Meeting


class EventFactory(DjangoModelFactory):
    class Meta:
        model = Event

    tenant = LazyFunction(_current_tenant)
    title = "Test event"
    description = "A test event."
    start = LazyFunction(lambda: timezone.now() + timedelta(days=1))
    end = LazyFunction(lambda: timezone.now() + timedelta(days=1, hours=1))
    all_day = False
    location = "Conference Room A"
    external_attendees = LazyFunction(list)
    recurrence = ""
    reminders = LazyFunction(list)
    conference_url = ""
    conference_provider = "none"
    related_module = ""
    related_id = ""
    status = "confirmed"
    organizer = LazyFunction(_current_user)
    visibility = "public"


class RecurringEventFactory(EventFactory):
    """A recurring event whose start is in the past (good for beat tests)."""

    recurrence = "FREQ=DAILY;INTERVAL=1"
    start = LazyFunction(lambda: timezone.now() - timedelta(days=1))
    end = LazyFunction(lambda: timezone.now() - timedelta(days=1, hours=-1))


class EventAttendeeFactory(DjangoModelFactory):
    class Meta:
        model = EventAttendee

    event = SubFactory(EventFactory)
    user = LazyFunction(_current_user)
    response = "none"
    required = True


class MeetingFactory(DjangoModelFactory):
    class Meta:
        model = Meeting

    event = SubFactory(EventFactory)
    agenda = "Discuss roadmap"
    action_items = LazyFunction(lambda: [{"text": "Follow up", "done": False}])
    follow_up_tasks_created = False
    engagement_score = 0.0
