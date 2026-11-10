"""Serializer tests for the leads app."""

from __future__ import annotations

import pytest

from leads.factories import LeadFactory
from leads.serializers import LeadConvertSerializer, LeadSerializer

pytestmark = pytest.mark.django_db


def test_lead_serializer_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "company": "Analytical Engine Co.",
        "emails": [{"email": "ada@example.com", "type": "work"}],
        "phones": [{"phone": "+15555550111", "type": "mobile"}],
        "lead_source": "referral",
        "rating": "hot",
        "website": "https://example.com",
        "billing_address": {"city": "London", "country": "UK"},
    }
    serializer = LeadSerializer(data=payload, context={"request": None})
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save(tenant=active_tenant, owner=user, created_by=user)
    assert instance.first_name == "Ada"
    assert instance.rating == "hot"


def test_lead_serializer_rejects_invalid_email(active_tenant):  # type: ignore[no-untyped-def]
    serializer = LeadSerializer(
        data={"first_name": "X", "emails": [{"email": "nope"}]},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "emails" in serializer.errors


def test_lead_serializer_rejects_invalid_website(active_tenant):  # type: ignore[no-untyped-def]
    serializer = LeadSerializer(
        data={"first_name": "X", "website": "nope"},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "website" in serializer.errors


def test_lead_serializer_rejects_bad_score(active_tenant):  # type: ignore[no-untyped-def]
    serializer = LeadSerializer(
        data={"first_name": "X", "score": 150},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "score" in serializer.errors


def test_lead_serializer_does_not_expose_tenant(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    data = LeadSerializer(lead, context={"request": None}).data
    assert "tenant" not in data
    assert "custom_fields" in data
    assert data["full_name"] != ""


def test_lead_convert_serializer_defaults(active_tenant):  # type: ignore[no-untyped-def]
    s = LeadConvertSerializer(data={})
    assert s.is_valid(), s.errors
    assert s.validated_data["create_deal"] is True


def test_lead_convert_serializer_with_amount(active_tenant):  # type: ignore[no-untyped-def]
    s = LeadConvertSerializer(data={"create_deal": True, "deal_amount": "1234.56"})
    assert s.is_valid(), s.errors
    assert s.validated_data["deal_amount"] == 1234.56  # type: ignore[comparison-overlap]
