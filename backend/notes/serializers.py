"""DRF serializers for the notes app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import DynamicFieldsMixin
from api.models import User
from notes.models import Note, NoteComment, NoteShare, NoteVersion


class NoteShareSerializer(serializers.ModelSerializer):
    """Serializer for the :class:`notes.models.NoteShare` through model."""

    email = serializers.SerializerMethodField()

    class Meta:
        model = NoteShare
        fields = ["id", "note", "user", "email", "permission", "created_at"]
        read_only_fields = ["id", "note", "email", "created_at"]

    def get_email(self, obj: NoteShare) -> str:
        return obj.user.email


class NoteCommentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`notes.models.NoteComment`."""

    email = serializers.SerializerMethodField()

    class Meta:
        model = NoteComment
        fields = [
            "id",
            "note",
            "user",
            "email",
            "selected_text",
            "body",
            "resolved",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "note", "user", "email", "created_at", "updated_at"]

    def get_email(self, obj: NoteComment) -> str:
        return obj.user.email


class NoteVersionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`notes.models.NoteVersion` (read-only)."""

    email = serializers.SerializerMethodField()

    class Meta:
        model = NoteVersion
        fields = [
            "id",
            "note",
            "user",
            "email",
            "body",
            "version_number",
            "created_at",
        ]
        read_only_fields = fields

    def get_email(self, obj: NoteVersion) -> str | None:
        return obj.user.email if obj.user_id else None


class NoteSerializer(DynamicFieldsMixin, serializers.ModelSerializer):
    """Serializer for :class:`notes.models.Note`."""

    shared_with = NoteShareSerializer(many=True, read_only=True)
    comments = NoteCommentSerializer(many=True, read_only=True)
    versions_count = serializers.SerializerMethodField()
    tags = serializers.ListField(
        child=serializers.CharField(max_length=64),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = Note
        fields = [
            "id",
            "title",
            "body",
            "body_type",
            "is_pinned",
            "is_private",
            "author",
            "last_edited_by",
            "related_module",
            "related_id",
            "mentions",
            "hashtags",
            "tags",
            "shared_with",
            "comments",
            "edit_history",
            "versions_count",
            "created_at",
            "updated_at",
            "deleted_at",
        ]
        read_only_fields = [
            "id",
            "author",
            "last_edited_by",
            "mentions",
            "hashtags",
            "shared_with",
            "comments",
            "edit_history",
            "versions_count",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    # ------------------------------------------------------------------ create

    def create(self, validated_data: dict) -> Note:  # type: ignore[override]
        request = self.context.get("request")
        if request is not None:
            if "author" not in validated_data:
                validated_data["author"] = request.user
        return super().create(validated_data)

    def update(self, instance: Note, validated_data: dict) -> Note:  # type: ignore[override]
        request = self.context.get("request")
        if request is not None:
            validated_data["last_edited_by"] = request.user
        return super().update(instance, validated_data)

    # ------------------------------------------------------------------ getters

    def get_versions_count(self, obj: Note) -> int:
        return obj.versions.count()

    # ------------------------------------------------------------------ validation

    def validate_tags(self, value: list[str]) -> list[str]:
        """Lowercase + de-duplicate tags."""
        seen: set[str] = set()
        out: list[str] = []
        for tag in value or []:
            tag = str(tag).strip().lower()
            if tag and tag not in seen:
                seen.add(tag)
                out.append(tag)
        return out


class NoteShareCreateSerializer(serializers.Serializer):
    """Payload for ``share`` action: ``{"user_id": <id>, "permission": "read|edit|admin"}``."""

    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source="user",
    )
    permission = serializers.ChoiceField(
        choices=NoteShare.PERMISSION_CHOICES,
        default=NoteShare.PERMISSION_READ,
    )


class NoteCommentCreateSerializer(serializers.Serializer):
    """Payload for ``comment`` action: ``{"body": "...", "selected_text": "..."}``."""

    body = serializers.CharField(max_length=10_000)
    selected_text = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=2000
    )


class NoteRestoreVersionSerializer(serializers.Serializer):
    """Payload for ``restore_version``: ``{"version_number": <int>}``."""

    version_number = serializers.IntegerField(min_value=1)
