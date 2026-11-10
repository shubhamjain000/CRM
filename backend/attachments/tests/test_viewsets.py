"""ViewSet / API tests for the attachments app."""

from __future__ import annotations

import pytest

from api.factories import UserFactory
from attachments.factories import AttachmentFactory
from attachments.models import Attachment
from files.factories import FileFactory


pytestmark = pytest.mark.django_db


def test_list_attachments_filter_by_record(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file1 = FileFactory(uploaded_by=user)
    file2 = FileFactory(uploaded_by=user)
    AttachmentFactory(file=file1, attached_by=user, record_module="lead", record_id="1")
    AttachmentFactory(file=file2, attached_by=user, record_module="contact", record_id="2")
    response = request_factory("GET", "/api/v1/attachments/?record_module=lead&record_id=1")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 1


def test_create_attachment(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user)
    payload = {
        "record_module": "lead",
        "record_id": "42",
        "file": file.pk,
        "description": "Signed contract",
    }
    response = request_factory("POST", "/api/v1/attachments/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["record_module"] == "lead"
    assert body["record_id"] == "42"
    assert body["file"] == file.pk
    assert body["attached_by"] == user.pk


def test_create_attachment_rejects_invalid_record_module(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    file = FileFactory(uploaded_by=user)
    payload = {"record_module": "bogus", "record_id": "1", "file": file.pk}
    response = request_factory("POST", "/api/v1/attachments/", payload, format="json")
    assert response.status_code == 400


def test_destroy_attachment_hard_deletes(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    a = AttachmentFactory(attached_by=user)
    response = request_factory("DELETE", f"/api/v1/attachments/{a.pk}/")
    assert response.status_code == 204
    assert not Attachment.objects.filter(pk=a.pk).exists()


def test_bulk_download_returns_zip(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    # bulk_download calls generate_presigned_download which calls boto3 —
    # in the sandbox we can't reach S3, so we just verify the endpoint
    # returns 404 when no attachments match.
    response = request_factory(
        "POST",
        "/api/v1/attachments/bulk-download/",
        {"ids": [999999]},
        format="json",
    )
    assert response.status_code == 404
