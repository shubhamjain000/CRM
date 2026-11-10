"""Serializer tests for the accounts app."""

from __future__ import annotations

import pytest

from accounts.factories import AccountFactory
from accounts.serializers import AccountSerializer

pytestmark = pytest.mark.django_db


def test_account_serializer_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "name": "Initech",
        "account_type": "customer",
        "industry": "Software",
        "website": "https://initech.example",
        "billing_address": {"line1": "123 Main", "city": "Austin", "country": "US"},
        "tags": ["enterprise", "vip"],
    }
    serializer = AccountSerializer(data=payload, context={"request": None})
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save(tenant=active_tenant, owner=user)
    assert instance.name == "Initech"
    assert instance.billing_address["city"] == "Austin"
    assert instance.tags == ["enterprise", "vip"]


def test_account_serializer_rejects_invalid_website(active_tenant, user):  # type: ignore[no-untyped-def]
    serializer = AccountSerializer(
        data={"name": "Bad Co", "website": "not-a-url"},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "website" in serializer.errors


def test_account_serializer_rejects_invalid_billing_address(active_tenant):  # type: ignore[no-untyped-def]
    serializer = AccountSerializer(
        data={"name": "Bad Co", "billing_address": "not-an-object"},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "billing_address" in serializer.errors


def test_account_serializer_does_not_expose_tenant(active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    data = AccountSerializer(account, context={"request": None}).data
    assert "tenant" not in data
    assert "id" in data


def test_account_serializer_includes_custom_fields_dict(active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    data = AccountSerializer(account, context={"request": None}).data
    assert "custom_fields" in data
    # No custom fields defined yet → empty dict.
    assert data["custom_fields"] == {}


def test_account_serializer_validates_tags_must_be_list(active_tenant):  # type: ignore[no-untyped-def]
    serializer = AccountSerializer(
        data={"name": "T", "tags": "not-a-list"},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "tags" in serializer.errors


def test_account_serializer_owner_defaults_to_request_user(active_tenant, user):  # type: ignore[no-untyped-def]
    class _FakeRequest:
        user = user

    serializer = AccountSerializer(
        data={"name": "Default Owner"},
        context={"request": _FakeRequest()},
    )
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save(tenant=active_tenant)
    assert instance.owner_id == user.pk
