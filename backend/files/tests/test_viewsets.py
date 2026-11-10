"""ViewSet / API tests for the files app.

The upload / download endpoints depend on S3/MinIO being reachable, which
isn't the case in the sandbox test environment. These tests therefore
exercise the metadata-only actions (list / retrieve / star / share /
version-history / restore-version / create-share-link) and the DLP /
parsing services (in test_services). The upload + download paths are
covered by an integration test in a real CI environment with MinIO.
"""

from __future__ import annotations

import pytest

from api.factories import UserFactory
from files.factories import FileFactory, FileShareFactory, FileVersionFactory
from files.models import File, FileShare, ShareLink


pytestmark = pytest.mark.django_db


def test_list_files_returns_only_callers_files(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    # file owned by the caller
    FileFactory(uploaded_by=user, name="mine")
    # file owned by someone else — should NOT appear in the caller's list
    other = UserFactory()
    FileFactory(uploaded_by=other, name="theirs")
    response = request_factory("GET", "/api/v1/files/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 1
    assert response.json()["results"][0]["name"] == "mine"


def test_star_action_toggles(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user, is_starred=False)
    response = request_factory("POST", f"/api/v1/files/{file.pk}/star/")
    assert response.status_code == 200, response.content
    file.refresh_from_db()
    assert file.is_starred is True


def test_share_action_creates_share(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user)
    other = UserFactory()
    response = request_factory(
        "POST",
        f"/api/v1/files/{file.pk}/share/",
        {"user_id": other.pk, "permission": "download"},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert FileShare.objects.filter(file=file, user=other, permission="download").exists()


def test_share_action_revokes_share(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user)
    share = FileShareFactory(file=file, permission="read")
    response = request_factory(
        "DELETE",
        f"/api/v1/files/{file.pk}/share/",
        {"user_id": share.user_id},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["deleted"] == 1


def test_create_share_link_action(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user)
    response = request_factory(
        "POST",
        f"/api/v1/files/{file.pk}/create-share-link/",
        {"watermark": True, "download_limit": 5},
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert ShareLink.objects.filter(token=body["token"], file=file).exists()
    assert body["download_limit"] == 5
    assert body["watermark"] is True


def test_version_history_action(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user)
    FileVersionFactory(file=file, version_number=1)
    FileVersionFactory(file=file, version_number=2)
    response = request_factory("GET", f"/api/v1/files/{file.pk}/version-history/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] == 2
    assert body["results"][0]["version_number"] == 2


def test_restore_version_action(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user, storage_key="current-key", size=100, version=1)
    FileVersionFactory(file=file, version_number=1, storage_key="v1-key", size=50)
    response = request_factory(
        "POST",
        f"/api/v1/files/{file.pk}/restore-version/",
        {"version_number": 1},
        format="json",
    )
    assert response.status_code == 200, response.content
    file.refresh_from_db()
    assert file.storage_key == "v1-key"
    assert file.size == 50
    assert file.version == 2  # bumped


def test_destroy_file_soft_deletes(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user)
    response = request_factory("DELETE", f"/api/v1/files/{file.pk}/")
    assert response.status_code == 204
    file.refresh_from_db()
    assert file.deleted_at is not None
    assert File.objects.filter(pk=file.pk).count() == 0


def test_filter_by_starred(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    FileFactory(uploaded_by=user, is_starred=False, name="a")
    FileFactory(uploaded_by=user, is_starred=True, name="b")
    response = request_factory("GET", "/api/v1/files/?is_starred=true")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_tag(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    FileFactory(uploaded_by=user, tags=["urgent", "phase-6"], name="a")
    FileFactory(uploaded_by=user, tags=["low-priority"], name="b")
    response = request_factory("GET", "/api/v1/files/?tag=phase-6")
    assert response.status_code == 200
    assert response.json()["count"] == 1
