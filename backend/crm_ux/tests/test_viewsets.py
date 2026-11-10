"""ViewSet / API tests for the crm_ux app."""

from __future__ import annotations

from unittest import mock

import pytest

from accounts.factories import AccountFactory
from accounts.models import Account
from api.factories import UserFactory
from api.models import TenantMembership
from contacts.factories import ContactFactory
from crm_ux.factories import (
    ActivityFactory,
    FileAttachmentFactory,
    NoteFactory,
    SavedViewFactory,
)
from crm_ux.models import Note, RecentlyViewed

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------- SavedView


def test_list_saved_views_returns_own_plus_shared(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    own = SavedViewFactory(user=user, tenant=active_tenant, module="lead", name="Mine")
    shared = SavedViewFactory(
        user=user, tenant=active_tenant, module="lead", name="Shared", is_shared=True
    )
    response = request_factory("GET", "/api/v1/saved-views/")
    assert response.status_code == 200, response.content
    body = response.json()
    ids = {item["id"] for item in body}
    assert own.pk in ids
    assert shared.pk in ids


def test_create_saved_view(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "module": "lead",
        "name": "Hot leads",
        "config": {"filters": [{"field": "rating", "op": "eq", "value": "hot"}]},
    }
    response = request_factory("POST", "/api/v1/saved-views/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["user"] == user.pk
    assert "tenant" not in body
    assert body["name"] == "Hot leads"


def test_set_default_clears_prior_default(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    first = SavedViewFactory(user=user, tenant=active_tenant, module="lead", name="A", is_default=True)
    second = SavedViewFactory(user=user, tenant=active_tenant, module="lead", name="B")
    response = request_factory("POST", f"/api/v1/saved-views/{second.pk}/set-default/", {}, format="json")
    assert response.status_code == 200, response.content
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.is_default is False
    assert second.is_default is True


def test_destroy_saved_view_owner_only(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    other = UserFactory(email="other@example.com")
    view = SavedViewFactory(user=other, tenant=active_tenant, module="lead", name="Other", is_shared=True)
    response = request_factory("DELETE", f"/api/v1/saved-views/{view.pk}/")
    assert response.status_code == 403


# ---------------------------------------------------------------- RecentlyViewed


def test_recently_viewed_upserts_on_create(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {"module": "lead", "record_id": "42"}
    first = request_factory("POST", "/api/v1/recently-viewed/", payload, format="json")
    assert first.status_code == 201, first.content
    second = request_factory("POST", "/api/v1/recently-viewed/", payload, format="json")
    assert second.status_code == 201, second.content
    # Same user+module+record_id → 1 row.
    assert RecentlyViewed.objects.filter(user=user, module="lead", record_id="42").count() == 1


def test_recently_viewed_list_caps_with_limit(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    for i in range(5):
        RecentlyViewed.objects.create(
            tenant=active_tenant, user=user, module="lead", record_id=str(i)
        )
    response = request_factory("GET", "/api/v1/recently-viewed/?limit=2")
    assert response.status_code == 200, response.content
    assert len(response.json()) == 2


def test_recently_viewed_clear(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    RecentlyViewed.objects.create(
        tenant=active_tenant, user=user, module="lead", record_id="1"
    )
    RecentlyViewed.objects.create(
        tenant=active_tenant, user=user, module="contact", record_id="2"
    )
    response = request_factory(
        "POST", "/api/v1/recently-viewed/clear/", {"module": "lead"}, format="json"
    )
    assert response.status_code == 200, response.content
    assert response.json()["deleted"] == 1
    assert RecentlyViewed.objects.filter(user=user).count() == 1


# ---------------------------------------------------------------- Activity


def test_activity_list_filters_by_record(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ActivityFactory(tenant=active_tenant, user=user, module="lead", record_id="1", action="created")
    ActivityFactory(tenant=active_tenant, user=user, module="lead", record_id="2", action="created")
    response = request_factory("GET", "/api/v1/activities/?module=lead&record_id=1")
    assert response.status_code == 200, response.content
    body = response.json()
    assert len(body) == 1
    assert body[0]["record_id"] == "1"


def test_activity_create_method_not_allowed(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST", "/api/v1/activities/", {"module": "lead", "record_id": "1"}, format="json"
    )
    assert response.status_code == 405


# ---------------------------------------------------------------- Note


def test_create_note_parses_mentions_and_hashtags(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    body = f"Hi @{user.email} please review #urgent"
    payload = {"module": "lead", "record_id": "1", "body": body}
    response = request_factory("POST", "/api/v1/notes/", payload, format="json")
    assert response.status_code == 201, response.content
    note = Note.objects.get(pk=response.json()["id"])
    assert note.mentions == [user.pk]
    assert note.hashtags == ["urgent"]
    # The viewset also logs a 'note_added' activity.
    from crm_ux.models import Activity

    assert Activity.objects.filter(
        module="lead", record_id="1", action="note_added", user=user
    ).exists()


def test_list_notes_filters_by_record(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    NoteFactory(tenant=active_tenant, user=user, module="lead", record_id="1", body="A")
    NoteFactory(tenant=active_tenant, user=user, module="lead", record_id="2", body="B")
    response = request_factory("GET", "/api/v1/notes/?module=lead&record_id=1")
    assert response.status_code == 200, response.content
    body = response.json()
    assert len(body) == 1
    assert body[0]["body"] == "A"


# ---------------------------------------------------------------- FileAttachment


def test_list_file_attachments_filters_by_record(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    FileAttachmentFactory(tenant=active_tenant, user=user, module="lead", record_id="1")
    FileAttachmentFactory(tenant=active_tenant, user=user, module="lead", record_id="2")
    response = request_factory("GET", "/api/v1/file-attachments/?module=lead&record_id=1")
    assert response.status_code == 200, response.content
    assert len(response.json()) == 1


def test_create_file_attachment_with_mocked_storage(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    from django.core.files.uploadedfile import SimpleUploadedFile

    upload = SimpleUploadedFile("note.txt", b"hello world", content_type="text/plain")
    with mock.patch("crm_ux.viewsets.default_storage") as mock_storage:
        mock_storage.save.return_value = "crm_ux/test/note.txt"
        mock_storage.url.return_value = "http://example.com/note.txt"
        response = request_factory(
            "POST",
            "/api/v1/file-attachments/",
            {"file": upload, "module": "lead", "record_id": "1"},
            format="multipart",
        )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["filename"] == "note.txt"
    assert body["file_size"] == len(b"hello world")
    assert body["mime_type"] == "text/plain"
    assert body["file_url"] == "http://example.com/note.txt"
    # An activity row should have been logged.
    from crm_ux.models import Activity

    assert Activity.objects.filter(
        module="lead", record_id="1", action="file_attached", user=user
    ).exists()


# ---------------------------------------------------------------- RecordLock


def test_create_record_lock(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST",
        "/api/v1/record-locks/",
        {"module": "lead", "record_id": "1"},
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["user"] == user.pk
    assert body["expires_at"] is not None


def test_record_lock_conflict_with_other_user(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    other = UserFactory(email="other@example.com")
    TenantMembership.objects.create(
        user=other, tenant=active_tenant, role=user.memberships.first().role, is_active=True  # type: ignore[attr-defined]
    )
    # Other user locks first.
    other_client = _client_for(other, active_tenant)
    first = other_client.post(
        "/api/v1/record-locks/",
        {"module": "lead", "record_id": "1"},
        format="json",
        HTTP_X_ORGANIZATION=str(active_tenant.slug),
    )
    assert first.status_code == 201, first.content
    # Caller is blocked.
    response = request_factory(
        "POST",
        "/api/v1/record-locks/",
        {"module": "lead", "record_id": "1"},
        format="json",
    )
    assert response.status_code == 409, response.content


# ---------------------------------------------------------------- Trash


def test_trash_list_aggregates_modules(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    account.soft_delete()
    contact = ContactFactory(tenant=active_tenant, owner=user)
    contact.soft_delete()
    response = request_factory("GET", "/api/v1/trash/")
    assert response.status_code == 200, response.content
    body = response.json()
    modules = {item["module"] for item in body["results"]}
    assert "account" in modules
    assert "contact" in modules


def test_trash_list_filters_by_module(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    account.soft_delete()
    contact = ContactFactory(tenant=active_tenant, owner=user)
    contact.soft_delete()
    response = request_factory("GET", "/api/v1/trash/?module=account")
    assert response.status_code == 200, response.content
    body = response.json()
    assert all(item["module"] == "account" for item in body["results"])
    assert body["count"] == 1


def test_trash_restore(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    account.soft_delete()
    response = request_factory(
        "POST",
        "/api/v1/trash/restore/",
        {"module": "account", "record_id": str(account.pk)},
        format="json",
    )
    assert response.status_code == 200, response.content
    account.refresh_from_db()
    assert account.deleted_at is None
    assert Account.objects.filter(pk=account.pk).count() == 1


def test_trash_purge(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    account.soft_delete()
    pk = account.pk
    response = request_factory(
        "POST",
        "/api/v1/trash/purge/",
        {"module": "account", "record_id": str(pk)},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert Account.all_objects.filter(pk=pk).count() == 0


# ---------------------------------------------------------------- Timeline


def test_timeline_endpoint_returns_buckets(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ActivityFactory(
        tenant=active_tenant, user=user, module="lead", record_id="1", action="created"
    )
    response = request_factory("GET", "/api/v1/timeline/lead/1/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert set(body.keys()) == {"Today", "Yesterday", "This Week", "Earlier"}


# ---------------------------------------------------------------- helpers


def _client_for(user, tenant):  # type: ignore[no-untyped-def]
    """Return an authenticated APIClient for ``user`` (separate session)."""
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=user)
    return client
