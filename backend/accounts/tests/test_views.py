"""ViewSet / API tests for the accounts app."""

from __future__ import annotations

import pytest

from accounts.factories import AccountFactory

pytestmark = pytest.mark.django_db


def _list(request_factory, query: str = ""):  # type: ignore[no-untyped-def]
    path = "/api/v1/accounts/" + (f"?{query}" if query else "")
    return request_factory("GET", path)


def test_list_accounts(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory.create_batch(3)
    response = _list(request_factory)
    assert response.status_code == 200, response.content
    data = response.json()
    assert "results" in data
    assert data["count"] == 3


def test_retrieve_account(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    response = request_factory("GET", f"/api/v1/accounts/{account.pk}/")
    assert response.status_code == 200, response.content
    assert response.json()["id"] == account.pk


def test_create_account(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "name": "Globex",
        "account_type": "prospect",
        "website": "https://globex.example",
        "billing_address": {"city": "Springfield"},
        "tags": ["hot"],
    }
    response = request_factory("POST", "/api/v1/accounts/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Globex"
    assert body["owner"] == user.pk


def test_update_account(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/accounts/{account.pk}/",
        {"industry": "Healthcare"},
        format="json",
    )
    assert response.status_code == 200, response.content
    account.refresh_from_db()
    assert account.industry == "Healthcare"


def test_destroy_soft_deletes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    from accounts.models import Account

    account = AccountFactory()
    response = request_factory("DELETE", f"/api/v1/accounts/{account.pk}/")
    assert response.status_code == 204, response.content
    account.refresh_from_db()
    assert account.deleted_at is not None
    assert Account.objects.filter(pk=account.pk).count() == 0
    assert Account.all_objects.filter(pk=account.pk).count() == 1


def test_restore_action(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    from accounts.models import Account

    account = AccountFactory()
    account.soft_delete()
    response = request_factory("POST", f"/api/v1/accounts/{account.pk}/restore/")
    assert response.status_code == 200, response.content
    assert Account.objects.filter(pk=account.pk).count() == 1


def test_mass_delete(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    accounts = AccountFactory.create_batch(3)
    ids = [a.pk for a in accounts]
    response = request_factory("POST", "/api/v1/accounts/mass-delete/", {"ids": ids}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["deleted"] == 3


def test_mass_update(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    accounts = AccountFactory.create_batch(3, account_type="prospect")
    ids = [a.pk for a in accounts]
    response = request_factory(
        "POST",
        "/api/v1/accounts/mass-update/",
        {"ids": ids, "fields": {"account_type": "customer"}},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["updated"] == 3
    for a in accounts:
        a.refresh_from_db()
        assert a.account_type == "customer"


def test_mass_update_rejects_disallowed_field(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    accounts = AccountFactory.create_batch(2)
    ids = [a.pk for a in accounts]
    response = request_factory(
        "POST",
        "/api/v1/accounts/mass-update/",
        {"ids": ids, "fields": {"name": "Hacked"}},
        format="json",
    )
    assert response.status_code == 400


def test_bulk_create(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = [
        {"name": "Acme", "account_type": "customer"},
        {"name": "Initech", "account_type": "prospect"},
    ]
    response = request_factory("POST", "/api/v1/accounts/bulk-create/", payload, format="json")
    assert response.status_code == 201, response.content
    assert len(response.json()) == 2


def test_merge_accounts(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    from accounts.models import Account

    source = AccountFactory(name="Source", description="source notes")
    target = AccountFactory(name="Target", description="")
    response = request_factory(
        "POST",
        "/api/v1/accounts/merge/",
        {"source_id": source.pk, "target_id": target.pk},
        format="json",
    )
    assert response.status_code == 200, response.content
    target.refresh_from_db()
    assert target.description == "source notes"  # copied
    source.refresh_from_db()
    assert source.deleted_at is not None  # soft-deleted
    # Target's name unchanged.
    assert target.name == "Target"
    assert Account.objects.filter(pk=source.pk).count() == 0


def test_sort_param(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    a1 = AccountFactory(name="Beta")
    a2 = AccountFactory(name="Alpha")
    response = request_factory("GET", "/api/v1/accounts/?sort=name")
    assert response.status_code == 200
    names = [r["name"] for r in response.json()["results"]]
    assert names == ["Alpha", "Beta"]


def test_fields_projection(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory(name="Visible")
    response = request_factory("GET", "/api/v1/accounts/?fields=id,name")
    assert response.status_code == 200
    row = response.json()["results"][0]
    assert set(row.keys()) == {"id", "name"}


def test_pagination_default_page_size(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory.create_batch(60)
    response = _list(request_factory)
    data = response.json()
    assert data["count"] == 60
    assert len(data["results"]) == 50  # default page_size


def test_filtering_by_account_type(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory.create_batch(2, account_type="customer")
    AccountFactory.create_batch(1, account_type="prospect")
    response = request_factory("GET", "/api/v1/accounts/?account_type=prospect")
    assert response.status_code == 200
    assert response.json()["count"] == 1
