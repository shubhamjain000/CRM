"""DRF serializers for the crm_ux app.

None of these serializers expose the ``tenant`` field — it is always set
implicitly from ``request.tenant`` (bound by :class:`api.middleware.TenantMiddleware`).
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from .models import (
    Activity,
    FileAttachment,
    Note,
    RecordLock,
    RecentlyViewed,
    SavedView,
)
from .services import parse_mentions_and_hashtags


class SavedViewSerializer(serializers.ModelSerializer):
    """Serializer for :class:`crm_ux.models.SavedView`.

    ``user`` is read-only — it is always set to ``request.user`` on create.
    """

    class Meta:
        model = SavedView
        fields = [
            "id",
            "user",
            "module",
            "name",
            "is_shared",
            "config",
            "is_default",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]


class RecentlyViewedSerializer(serializers.ModelSerializer):
    """Serializer for :class:`crm_ux.models.RecentlyViewed`.

    ``user`` and ``viewed_at`` are read-only — they are set on create by
    the viewset's upsert logic.
    """

    class Meta:
        model = RecentlyViewed
        fields = ["id", "user", "module", "record_id", "viewed_at", "created_at", "updated_at"]
        read_only_fields = ["id", "user", "viewed_at", "created_at", "updated_at"]


class ActivitySerializer(serializers.ModelSerializer):
    """Serializer for :class:`crm_ux.models.Activity` (read-only)."""

    class Meta:
        model = Activity
        fields = [
            "id",
            "user",
            "module",
            "record_id",
            "record_name",
            "action",
            "description",
            "metadata",
            "created_at",
        ]
        read_only_fields = fields


class NoteSerializer(serializers.ModelSerializer):
    """Serializer for :class:`crm_ux.models.Note`.

    On create and update, the ``mentions`` and ``hashtags`` JSON fields are
    *re-parsed* from the body (overriding any client-supplied values) so they
    always reflect the current body content.
    """

    class Meta:
        model = Note
        fields = [
            "id",
            "user",
            "module",
            "record_id",
            "body",
            "mentions",
            "hashtags",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "mentions", "hashtags", "created_at", "updated_at"]

    def _resolve_tenant(self) -> Any:
        request = self.context.get("request")
        return getattr(request, "tenant", None) if request else None

    def _enrich(self, validated_data: dict[str, Any]) -> dict[str, Any]:
        body = validated_data.get("body", "")
        parsed = parse_mentions_and_hashtags(body, tenant=self._resolve_tenant())
        validated_data["mentions"] = parsed["mentions"]
        validated_data["hashtags"] = parsed["hashtags"]
        return validated_data

    def create(self, validated_data: dict[str, Any]) -> Note:  # type: ignore[override]
        return super().create(self._enrich(validated_data))

    def update(self, instance: Note, validated_data: dict[str, Any]) -> Note:  # type: ignore[override]
        return super().update(instance, self._enrich(validated_data))


class FileAttachmentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`crm_ux.models.FileAttachment`."""

    class Meta:
        model = FileAttachment
        fields = [
            "id",
            "user",
            "module",
            "record_id",
            "filename",
            "file_url",
            "file_size",
            "mime_type",
            "s3_key",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "file_url",
            "file_size",
            "mime_type",
            "s3_key",
            "created_at",
        ]


class RecordLockSerializer(serializers.ModelSerializer):
    """Serializer for :class:`crm_ux.models.RecordLock`."""

    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = RecordLock
        fields = [
            "id",
            "user",
            "module",
            "record_id",
            "locked_at",
            "expires_at",
            "is_expired",
            "created_at",
        ]
        read_only_fields = ["id", "user", "locked_at", "expires_at", "is_expired", "created_at"]


class TrashItemSerializer(serializers.Serializer):
    """Serializer for the virtual "trash item" representation.

    Trash items are not backed by a single ORM model — they are aggregated
    from soft-deleted rows across the four CRM modules by
    :func:`crm_ux.services.get_trash_items`.
    """

    id = serializers.IntegerField()
    module = serializers.CharField()
    name = serializers.CharField()
    deleted_at = serializers.DateTimeField()
    owner_id = serializers.IntegerField(allow_null=True)
    owner_email = serializers.CharField(allow_null=True, required=False)
