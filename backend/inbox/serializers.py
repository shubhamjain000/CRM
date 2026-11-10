"""DRF serializers for the unified inbox app."""

from __future__ import annotations

from rest_framework import serializers

from .models import InboxMacro, UnifiedConversation, UnifiedMessage


class UnifiedMessageSerializer(serializers.ModelSerializer):
    """Serializer for :class:`UnifiedMessage`."""

    class Meta:
        model = UnifiedMessage
        fields = [
            "id",
            "conversation",
            "channel",
            "sender",
            "body",
            "attachments",
            "timestamp",
            "is_read",
            "metadata",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "timestamp", "created_at", "updated_at"]


class UnifiedConversationSerializer(serializers.ModelSerializer):
    """Serializer for :class:`UnifiedConversation`."""

    assigned_to_email = serializers.CharField(
        source="assigned_to.email", read_only=True, default=""
    )
    merged_into_id = serializers.IntegerField(
        source="merged_into_id", read_only=True, default=None
    )
    message_count_db = serializers.IntegerField(source="message_count", read_only=True)

    class Meta:
        model = UnifiedConversation
        fields = [
            "id",
            "channel",
            "external_id",
            "subject",
            "participant_name",
            "participant_identifier",
            "assigned_to",
            "assigned_to_email",
            "status",
            "priority",
            "sla_response_deadline",
            "sla_resolution_deadline",
            "tags",
            "internal_notes",
            "related_module",
            "related_id",
            "is_merged",
            "merged_into",
            "merged_into_id",
            "last_message_at",
            "message_count",
            "message_count_db",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "assigned_to_email",
            "merged_into",
            "merged_into_id",
            "last_message_at",
            "message_count_db",
            "created_at",
            "updated_at",
        ]


class InboxMacroSerializer(serializers.ModelSerializer):
    """Serializer for :class:`InboxMacro`."""

    created_by_email = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )

    class Meta:
        model = InboxMacro
        fields = [
            "id",
            "name",
            "actions",
            "created_by",
            "created_by_email",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_by_email", "created_at", "updated_at"]


__all__ = [
    "InboxMacroSerializer",
    "UnifiedConversationSerializer",
    "UnifiedMessageSerializer",
]
