"""ViewSet / API tests for the contacts app."""

from __future__ import annotations

import pytest

from accounts.factories import AccountFactory
from contacts.factories import ContactFactory

pytestmark = pytest.mark.django_db


def test_list_contacts(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory.create_batch(3)
    response = request_factory("GET", "/api/v1/contacts/")
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_retrieve_contact(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory()
    response = request_factory("GET", f"/api/v1/contacts/{contact.pk}/")
    assert response.status_code == 200
    assert response.json()["id"] == contact.pk


def test_create_contact(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    payload = {
        "first_name": "Margaret",
        "last_name": "Hamilton",
        "account": account.pk,
        "title": "Engineer",
        "emails": [{"email": "margaret@example.com", "type": "work"}],
        "phones": [{"phone": "+15555550199", "type": "mobile"}],
        "lead_source": "event",
    }
    response = request_factory("POST", "/api/v1/contacts/", payload, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["owner"] == user.pk


def test_update_contact(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/contacts/{contact.pk}/",
        {"title": "CTO"},
        format="json",
    )
    assert response.status_code == 200
    contact.refresh_from_db()
    assert contact.title == "CTO"


def test_destroy_soft_deletes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    from contacts.models import Contact

    contact = ContactFactory()
    response = request_factory("DELETE", f"/api/v1/contacts/{contact.pk}/")
    assert response.status_code == 204
    contact.refresh_from_db()
    assert contact.deleted_at is not None
    assert Contact.objects.filter(pk=contact.pk).count() == 0


def test_restore_action(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    from contacts.models import Contact

    contact = ContactFactory()
    contact.soft_delete()
    response = request_factory("POST", f"/api/v1/contacts/{contact.pk}/restore/")
    assert response.status_code == 200
    assert Contact.objects.filter(pk=contact.pk).count() == 1


def test_mass_delete_contacts(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    contacts = ContactFactory.create_batch(3)
    ids = [c.pk for c in contacts]
    response = request_factory("POST", "/api/v1/contacts/mass-delete/", {"ids": ids}, format="json")
    assert response.status_code == 200
    assert response.json()["deleted"] == 3


def test_mass_update_contacts(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    contacts = ContactFactory.create_batch(2, do_not_call=False)
    ids = [c.pk for c in contacts]
    response = request_factory(
        "POST",
        "/api/v1/contacts/mass-update/",
        {"ids": ids, "fields": {"do_not_call": True}},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 2
    for c in contacts:
        c.refresh_from_db()
        assert c.do_not_call is True


def test_bulk_create_contacts(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = [
        {"first_name": "Ada"},
        {"first_name": "Alan"},
    ]
    response = request_factory("POST", "/api/v1/contacts/bulk-create/", payload, format="json")
    assert response.status_code == 201
    assert len(response.json()) == 2


def test_merge_contacts(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    from contacts.models import Contact

    source = ContactFactory(
        first_name="Source",
        emails=[{"email": "source@example.com", "type": "work"}],
        phones=[{"phone": "+15555550001", "type": "work"}],
    )
    target = ContactFactory(
        first_name="Target",
        emails=[{"email": "target@example.com", "type": "work"}],
        phones=[],
    )
    response = request_factory(
        "POST",
        "/api/v1/contacts/merge/",
        {"source_id": source.pk, "target_id": target.pk},
        format="json",
    )
    assert response.status_code == 200, response.content
    target.refresh_from_db()
    # Both emails merged.
    emails = {e["email"] for e in target.emails}
    assert "source@example.com" in emails
    assert "target@example.com" in emails
    source.refresh_from_db()
    assert source.deleted_at is not None
    assert Contact.objects.filter(pk=source.pk).count() == 0


def test_filter_by_email(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(emails=[{"email": "alpha@example.com", "type": "work"}])
    ContactFactory(emails=[{"email": "beta@example.com", "type": "work"}])
    response = request_factory("GET", "/api/v1/contacts/?email=alpha@example.com")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_account(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    acct = AccountFactory()
    ContactFactory.create_batch(2, account=acct)
    ContactFactory.create_batch(1, account=None)
    response = request_factory("GET", f"/api/v1/contacts/?account={acct.pk}")
    assert response.status_code == 200
    assert response.json()["count"] == 2


def test_sort_by_first_name(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(first_name="Zed")
    ContactFactory(first_name="Amy")
    response = request_factory("GET", "/api/v1/contacts/?sort=first_name")
    names = [r["first_name"] for r in response.json()["results"]]
    assert names == ["Amy", "Zed"]


def test_fields_projection(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(first_name="Visible")
    response = request_factory("GET", "/api/v1/contacts/?fields=id,first_name")
    row = response.json()["results"][0]
    assert set(row.keys()) == {"id", "first_name"}
