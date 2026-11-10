"""factory_boy factories for the calls app."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from factory import LazyFunction
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from calls.models import Call


class CallFactory(DjangoModelFactory):
    class Meta:
        model = Call

    tenant = LazyFunction(_current_tenant)
    subject = "Test call"
    call_type = "outbound"
    duration = 120
    outcome = "connected"
    recording_url = ""
    transcription = ""
    sentiment = ""
    related_module = ""
    related_id = ""
    voip_provider = ""
    voip_call_id = ""
    notes = ""
    started_at = LazyFunction(lambda: timezone.now() - timedelta(minutes=10))
    ended_at = LazyFunction(lambda: timezone.now() - timedelta(minutes=8))
    created_by = LazyFunction(_current_user)


class MissedCallFactory(CallFactory):
    """A missed inbound call (zero duration)."""

    call_type = "missed"
    outcome = "no_answer"
    duration = 0
    ended_at = None
