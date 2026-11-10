"""Serializer tests for the contacts app."""

from __future__ import annotations

import pytest

from accounts.factories import AccountFactory
from contacts.factories import ContactFactory
from contacts.serializers import ContactSerializer

pytestmark = pytest.mark.django_db


def test_contact_serializer_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    payload = {
        "first_name": "Grace",
        "last_name": "Hopper",
        "account": account.pk,
        "title": "Admiral",
        "emails": [{"email": "grace@example.com", "type": "work"}],
        "phones": [{"phone": "+15555550100", "type": "mobile"}],
        "lead_source": "referral",
        "addresses": [{"city": "NYC", "country": "US"}],
        "social_profiles": {"linkedin": "https://linkedin.com/in/grace"},
    }
    serializer = ContactSerializer(data=payload, context={"request": None})
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save(tenant=active_tenant, owner=user)
    assert instance.first_name == "Grace"
    assert instance.emails[0]["email"] == "grace@example.com"
    assert instance.account_id == account.pk


def test_contact_serializer_rejects_invalid_email(active_tenant):  # type: ignore[no-untyped-def]
    serializer = ContactSerializer(
        data={"first_name": "X", "emails": [{"email": "not-an-email"}]},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "emails" in serializer.errors


def test_contact_serializer_rejects_invalid_phone(active_tenant):  # type: ignore[no-untyped-def]
    serializer = ContactSerializer(
        data={"first_name": "X", "phones": [{"phone": "abc"}]},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "phones" in serializer.errors


def test_contact_serializer_rejects_invalid_social_url(active_tenant):  # type: ignore[no-untyped-def]
    serializer = ContactSerializer(
        data={"first_name": "X", "social_profiles": {"linkedin": "not-a-url"}},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "social_profiles" in serializer.errors


def test_contact_serializer_does_not_expose_tenant(active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory()
    data = ContactSerializer(contact, context={"request": None}).data
    assert "tenant" not in data
    assert "custom_fields" in data


def test_contact_serializer_full_name_read_only(active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory(first_name="Linus", last_name="Torvalds")
    data = ContactSerializer(contact, context={"request": None}).data
    assert data["full_name"] == "Linus Torvalds"
