"""factory_boy factories for the files app."""

from __future__ import annotations

import secrets

from factory import LazyFunction, SubFactory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user, UserFactory
from files.models import DownloadLog, File, FileShare, FileVersion, ShareLink


def _storage_key() -> str:
    return f"test-bucket/{secrets.token_urlsafe(8)}/file.bin"


class FileFactory(DjangoModelFactory):
    class Meta:
        model = File

    tenant = LazyFunction(_current_tenant)
    name = "test-file.txt"
    original_name = "test-file.txt"
    size = 1024
    mime_type = "text/plain"
    extension = "txt"
    storage_key = LazyFunction(_storage_key)
    storage_provider = "minio"
    version = 1
    uploaded_by = LazyFunction(_current_user)
    related_module = ""
    related_id = ""
    preview_url = ""
    thumbnail_url = ""
    is_starred = False
    description = ""
    tags = LazyFunction(lambda: ["phase-6"])
    virus_scan_status = "pending"
    ocr_text = ""
    ocr_status = "skipped"


class ImageFileFactory(FileFactory):
    name = "image.png"
    original_name = "image.png"
    mime_type = "image/png"
    extension = "png"


class PdfFileFactory(FileFactory):
    name = "doc.pdf"
    original_name = "doc.pdf"
    mime_type = "application/pdf"
    extension = "pdf"


class FileShareFactory(DjangoModelFactory):
    class Meta:
        model = FileShare

    file = SubFactory(FileFactory)
    user = SubFactory(UserFactory)
    permission = "read"


class FileVersionFactory(DjangoModelFactory):
    class Meta:
        model = FileVersion

    file = SubFactory(FileFactory)
    version_number = 1
    size = 1024
    storage_key = LazyFunction(_storage_key)
    uploaded_by = LazyFunction(_current_user)
    change_summary = "Snapshot"


class ShareLinkFactory(DjangoModelFactory):
    class Meta:
        model = ShareLink

    file = SubFactory(FileFactory)
    token = LazyFunction(lambda: secrets.token_urlsafe(32))
    created_by = LazyFunction(_current_user)
    expires_at = None
    password_hash = ""
    download_limit = None
    download_count = 0
    watermark = True


class DownloadLogFactory(DjangoModelFactory):
    class Meta:
        model = DownloadLog

    file = SubFactory(FileFactory)
    user = LazyFunction(_current_user)
    ip = "127.0.0.1"
    user_agent = "pytest/0.0"
    share_link = None
    watermarked = False
