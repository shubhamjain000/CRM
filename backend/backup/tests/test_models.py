"""Model-layer tests for the backup app."""

from __future__ import annotations

import pytest

from backup.models import STATUS_COMPLETED, TYPE_FULL, BackupRecord


pytestmark = pytest.mark.django_db


def test_backup_record_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    rec = BackupRecord.objects.create(
        tenant=active_tenant,
        type=TYPE_FULL,
        status=STATUS_COMPLETED,
        size_bytes=1024 * 1024,
        s3_key="backups/2024/01/full.tar.gz",
    )
    assert "full" in str(rec)
    assert rec.size_bytes == 1024 * 1024
