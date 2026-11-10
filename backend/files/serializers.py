"""DRF serializers for the files app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import DynamicFieldsMixin
from api.models import User
from files.models import DownloadLog, File, FileShare, FileVersion, ShareLink


class FileShareSerializer(serializers.ModelSerializer):
    """Serializer for the :class:`files.models.FileShare` through model."""

    email = serializers.SerializerMethodField()

    class Meta:
        model = FileShare
        fields = ["id", "file", "user", "email", "permission", "created_at"]
        read_only_fields = ["id", "file", "email", "created_at"]

    def get_email(self, obj: FileShare) -> str:
        return obj.user.email


class FileVersionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`files.models.FileVersion` (read-only)."""

    email = serializers.SerializerMethodField()

    class Meta:
        model = FileVersion
        fields = [
            "id",
            "file",
            "version_number",
            "size",
            "storage_key",
            "uploaded_by",
            "email",
            "change_summary",
            "created_at",
        ]
        read_only_fields = fields

    def get_email(self, obj: FileVersion) -> str:
        return obj.uploaded_by.email


class ShareLinkSerializer(serializers.ModelSerializer):
    """Serializer for :class:`files.models.ShareLink`."""

    class Meta:
        model = ShareLink
        fields = [
            "id",
            "file",
            "token",
            "created_by",
            "expires_at",
            "download_limit",
            "download_count",
            "watermark",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "file",
            "token",
            "created_by",
            "download_count",
            "created_at",
        ]


class DownloadLogSerializer(serializers.ModelSerializer):
    """Serializer for :class:`files.models.DownloadLog` (read-only)."""

    email = serializers.SerializerMethodField()

    class Meta:
        model = DownloadLog
        fields = [
            "id",
            "file",
            "user",
            "email",
            "ip",
            "user_agent",
            "share_link",
            "watermarked",
            "created_at",
        ]
        read_only_fields = fields

    def get_email(self, obj: DownloadLog) -> str | None:
        return obj.user.email if obj.user_id else None


class FileSerializer(DynamicFieldsMixin, serializers.ModelSerializer):
    """Serializer for :class:`files.models.File`."""

    shared_with = FileShareSerializer(many=True, read_only=True)
    versions_count = serializers.SerializerMethodField()
    tags = serializers.ListField(
        child=serializers.CharField(max_length=64),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = File
        fields = [
            "id",
            "name",
            "original_name",
            "size",
            "mime_type",
            "extension",
            "storage_key",
            "storage_provider",
            "version",
            "uploaded_by",
            "related_module",
            "related_id",
            "shared_with",
            "versions_count",
            "preview_url",
            "thumbnail_url",
            "is_starred",
            "description",
            "tags",
            "virus_scan_status",
            "ocr_text",
            "ocr_status",
            "created_at",
            "updated_at",
            "deleted_at",
        ]
        read_only_fields = [
            "id",
            "size",
            "mime_type",
            "extension",
            "storage_key",
            "version",
            "uploaded_by",
            "shared_with",
            "versions_count",
            "preview_url",
            "thumbnail_url",
            "virus_scan_status",
            "ocr_text",
            "ocr_status",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    def get_versions_count(self, obj: File) -> int:
        return obj.versions.count()

    def create(self, validated_data: dict) -> File:  # type: ignore[override]
        request = self.context.get("request")
        if request is not None and "uploaded_by" not in validated_data:
            validated_data["uploaded_by"] = request.user
        return super().create(validated_data)

    def validate_tags(self, value: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for tag in value or []:
            tag = str(tag).strip().lower()
            if tag and tag not in seen:
                seen.add(tag)
                out.append(tag)
        return out


class FileShareCreateSerializer(serializers.Serializer):
    """Payload for ``share`` action: ``{"user_id": <id>, "permission": "read|download|admin"}``."""

    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source="user",
    )
    permission = serializers.ChoiceField(
        choices=FileShare.PERMISSION_CHOICES,
        default=FileShare.PERMISSION_READ,
    )


class ShareLinkCreateSerializer(serializers.Serializer):
    """Payload for ``create_share_link`` action."""

    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=255
    )
    download_limit = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    watermark = serializers.BooleanField(default=True)


class FileUploadSerializer(serializers.Serializer):
    """Payload for ``upload`` action (multipart chunked upload)."""

    file = serializers.FileField()
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    related_module = serializers.CharField(required=False, allow_blank=True, default="")
    related_id = serializers.CharField(required=False, allow_blank=True, default="")
    tags = serializers.ListField(
        child=serializers.CharField(max_length=64), required=False, allow_empty=True
    )


class FileRestoreVersionSerializer(serializers.Serializer):
    """Payload for ``restore_version``: ``{"version_number": <int>}``."""

    version_number = serializers.IntegerField(min_value=1)
