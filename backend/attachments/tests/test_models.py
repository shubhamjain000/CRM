"""Model-level tests for the attachments app."""

from __future__ import annotations

import pytest
from django.db import IntegrityError

from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from attachments.factories import AttachmentFactory
from attachments.models import Attachment
from files.factories import FileFactory


pytestmark = pytest.mark.django_db


def test_attachment_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    a = AttachmentFactory()
    assert a.pk is not None
    assert a.tenant_id == active_tenant.pk
    assert a.record_module == "lead"


def test_attachment_str(active_tenant):  # type: ignore[no-untyped-def]
    a = AttachmentFactory(record_module="contact", record_id="42")
    s = str(a)
    assert "contact:42" in s


def test_unique_per_record_file(active_tenant):  # type: ignore[no-untyped-def]
    a = AttachmentFactory()
    # Same record_module + record_id + file → integrity error.
    dup = Attachment(
        tenant=a.tenant,
        record_module=a.record_module,
        record_id=a.record_id,
        file=a.file,
        attached_by=a.attached_by,
    )
    with pytest.raises(IntegrityError):
        dup.save()


def test_record_module_check_constraint(active_tenant):  # type: ignore[no-untyped-def]
    a = AttachmentFactory.build(record_module="bogus")
    a.tenant = active_tenant
    with pytest.raises(IntegrityError):
        a.save()


def test_tenant_scoping(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        AttachmentFactory(record_id="100")
    set_current_tenant(active_tenant)
    AttachmentFactory(record_id="200")
    ids = [a.record_id for a in Attachment.objects.all()]
    assert ids == ["200"]


def test_cascade_delete_when_file_deleted(active_tenant):  # type: ignore[no-untyped-def]
    a = AttachmentFactory()
    file_pk = a.file_id
    # Hard-delete the file row (bypass soft-delete to trigger CASCADE).
    a.file.delete()
    assert not Attachment.objects.filter(pk=a.pk).exists()
    # The File row is gone too.
    from files.models import File

    assert not File.all_objects.filter(pk=file_pk).exists()


def test_different_records_can_share_a_file(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory()
    a1 = AttachmentFactory(file=file, record_module="lead", record_id="1")
    a2 = AttachmentFactory(file=file, record_module="contact", record_id="2")
    assert a1.pk != a2.pk
    assert a1.file_id == a2.file_id == file.pk
