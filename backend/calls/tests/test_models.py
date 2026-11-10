"""Model-level tests for the calls app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.db import IntegrityError
from django.utils import timezone

from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from calls.factories import CallFactory, MissedCallFactory
from calls.models import Call


pytestmark = pytest.mark.django_db


def test_call_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory()
    assert call.pk is not None
    assert call.tenant_id == active_tenant.pk
    assert call.call_type == "outbound"
    assert call.outcome == "connected"
    assert call.duration == 120


def test_call_str(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory(subject="Demo call")
    assert "Demo call" in str(call)
    assert "outbound" in str(call)


def test_duration_minutes(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory(duration=120)
    assert call.duration_minutes == 2.0


def test_soft_delete(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory()
    call.soft_delete()
    assert Call.objects.filter(pk=call.pk).count() == 0
    assert Call.all_objects.filter(pk=call.pk).count() == 1


def test_check_constraint_rejects_invalid_call_type(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory.build(call_type="bogus")
    call.tenant = active_tenant
    with pytest.raises(IntegrityError):
        call.save()


def test_check_constraint_rejects_invalid_outcome(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory.build(outcome="bogus")
    call.tenant = active_tenant
    with pytest.raises(IntegrityError):
        call.save()


def test_check_constraint_rejects_invalid_sentiment(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory.build(sentiment="bogus")
    call.tenant = active_tenant
    with pytest.raises(IntegrityError):
        call.save()


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        CallFactory(subject="Other")
    set_current_tenant(active_tenant)
    CallFactory(subject="Mine")
    subjects = [c.subject for c in Call.objects.all()]
    assert subjects == ["Mine"]


def test_missed_call_factory_zero_duration(active_tenant):  # type: ignore[no-untyped-def]
    call = MissedCallFactory()
    assert call.call_type == "missed"
    assert call.duration == 0
    assert call.ended_at is None


def test_attendees_m2m(active_tenant, user):  # type: ignore[no-untyped-def]
    call = CallFactory()
    other = UserFactory()
    call.attendees.set([user, other])
    assert set(call.attendees.all()) == {user, other}


def test_related_record_fields_set(active_tenant):  # type: ignore[no-untyped-def]
    call = CallFactory(related_module="lead", related_id="42")
    assert call.related_module == "lead"
    assert call.related_id == "42"
