"""DRF serializers for the attachments app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import DynamicFieldsMixin
from api.models import User
from attachments.models import Attachment
from files.models import File


class AttachmentSerializer(DynamicFieldsMixin, serializers.ModelSerializer):
    """Serializer for :class:`attachments.models.Attachment`."""

    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    file_mime_type = serializers.SerializerMethodField()
    file_thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            "id",
            "tenant",
            "record_module",
            "record_id",
            "file",
            "file_name",
            "file_size",
            "file_mime_type",
            "file_thumbnail_url",
            "attached_by",
            "description",
            "is_inline",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "tenant",
            "attached_by",
            "file_name",
            "file_size",
            "file_mime_type",
            "file_thumbnail_url",
            "created_at",
            "updated_at",
        ]

    def get_file_name(self, obj: Attachment) -> str:
        return obj.file.name

    def get_file_size(self, obj: Attachment) -> int:
        return obj.file.size

    def get_file_mime_type(self, obj: Attachment) -> str:
        return obj.file.mime_type

    def get_file_thumbnail_url(self, obj: Attachment) -> str:
        return obj.file.thumbnail_url

    def create(self, validated_data: dict) -> Attachment:  # type: ignore[override]
        request = self.context.get("request")
        if request is not None and "attached_by" not in validated_data:
            validated_data["attached_by"] = request.user
        return super().create(validated_data)


class AttachmentBulkDownloadSerializer(serializers.Serializer):
    """Payload for ``bulk_download``: ``{"ids": [<attachment_id>, ...]}``."""

    ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        allow_empty=False,
    )


class AttachmentCreateSerializer(serializers.Serializer):
    """Lightweight create payload (used by the bulk-attach helper in deploy)."""

    record_module = serializers.ChoiceField(
        choices=[c[0] for c in Attachment.RECORD_MODULE_CHOICES]
    )
    record_id = serializers.CharField(max_length=64)
    file = serializers.PrimaryKeyRelatedField(queryset=File.objects.all())
    description = serializers.CharField(required=False, allow_blank=True, default="")
    is_inline = serializers.BooleanField(default=False)
    attached_by = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), required=False
    )
