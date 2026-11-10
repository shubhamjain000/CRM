"""Model-level tests for the files app."""

from __future__ import annotations

import pytest
from django.db import IntegrityError

from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from files.factories import (
    FileFactory,
    FileShareFactory,
    FileVersionFactory,
    ShareLinkFactory,
)
from files.models import File, FileShare, FileVersion, ShareLink


pytestmark = pytest.mark.django_db


def test_file_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory()
    assert file.pk is not None
    assert file.tenant_id == active_tenant.pk
    assert file.storage_provider == "minio"


def test_file_str(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory(name="report.pdf", mime_type="application/pdf")
    assert "report.pdf" in str(file)


def test_soft_delete(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory()
    file.soft_delete()
    assert File.objects.filter(pk=file.pk).count() == 0
    assert File.all_objects.filter(pk=file.pk).count() == 1


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        FileFactory(name="Other")
    set_current_tenant(active_tenant)
    FileFactory(name="Mine")
    names = [f.name for f in File.objects.all()]
    assert names == ["Mine"]


def test_storage_provider_check_constraint(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory.build(storage_provider="bogus")
    file.tenant = active_tenant
    with pytest.raises(IntegrityError):
        file.save()


def test_virus_scan_status_check_constraint(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory.build(virus_scan_status="bogus")
    file.tenant = active_tenant
    with pytest.raises(IntegrityError):
        file.save()


def test_ocr_status_check_constraint(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory.build(ocr_status="bogus")
    file.tenant = active_tenant
    with pytest.raises(IntegrityError):
        file.save()


def test_file_share_unique_per_file_user(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory()
    share = FileShareFactory(file=file)
    with pytest.raises(IntegrityError):
        FileShare.objects.create(file=file, user=share.user, permission="download")


def test_file_share_permission_check_constraint(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory()
    user = UserFactory()
    share = FileShare(file=file, user=user, permission="bogus")
    with pytest.raises(IntegrityError):
        share.save()


def test_file_version_unique_per_file_number(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory()
    FileVersionFactory(file=file, version_number=1)
    with pytest.raises(IntegrityError):
        FileVersionFactory(file=file, version_number=1)


def test_next_version_number_increments(active_tenant):  # type: ignore[no-untyped-def]
    file = FileFactory()
    assert file.next_version_number() == 1
    FileVersionFactory(file=file, version_number=1)
    assert file.next_version_number() == 2


def test_share_link_token_unique(active_tenant):  # type: ignore[no-untyped-def]
    link = ShareLinkFactory(token="abc123")
    with pytest.raises(IntegrityError):
        ShareLink.objects.create(
            file=link.file, token="abc123", created_by=link.created_by
        )


def test_share_link_expiry_properties(active_tenant):  # type: ignore[no-untyped-def]
    from django.utils import timezone
    from datetime import timedelta

    link = ShareLinkFactory()
    assert link.is_expired is False  # no expiry set
    assert link.is_exhausted is False  # no limit set

    link.expires_at = timezone.now() - timedelta(minutes=1)
    link.save(update_fields=["expires_at"])
    link.refresh_from_db()
    assert link.is_expired is True

    link.download_limit = 1
    link.download_count = 1
    link.save(update_fields=["download_limit", "download_count"])
    link.refresh_from_db()
    assert link.is_exhausted is True


def test_is_image_is_pdf_is_video_properties(active_tenant):  # type: ignore[no-untyped-def]
    img = FileFactory(mime_type="image/png")
    pdf = FileFactory(mime_type="application/pdf")
    mov = FileFactory(mime_type="video/mp4")
    txt = FileFactory(mime_type="text/plain")
    assert img.is_image is True
    assert pdf.is_pdf is True
    assert mov.is_video is True
    assert not txt.is_image and not txt.is_pdf and not txt.is_video
