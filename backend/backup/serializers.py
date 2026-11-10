"""DRF serializers for the backup app."""

from __future__ import annotations

from rest_framework import serializers

from .models import BackupRecord


class BackupRecordSerializer(serializers.ModelSerializer):
    """Serializer for :class:`BackupRecord` — all fields read-only."""

    class Meta:
        model = BackupRecord
        fields = [
            "id",
            "type",
            "status",
            "size_bytes",
            "s3_key",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


__all__ = ["BackupRecordSerializer"]
