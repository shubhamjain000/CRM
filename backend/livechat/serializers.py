"""DRF serializers for the livechat app."""

from __future__ import annotations

from rest_framework import serializers

from .models import ChatMessage, ChatSession, CannedResponse, ProactiveRule


class ChatMessageSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ChatMessage`."""

    class Meta:
        model = ChatMessage
        fields = [
            "id",
            "session",
            "sender",
            "body",
            "attachments",
            "timestamp",
            "is_read",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "timestamp", "created_at", "updated_at"]


class ChatSessionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ChatSession`."""

    assigned_to_email = serializers.CharField(
        source="assigned_to.email", read_only=True, default=""
    )
    message_count = serializers.SerializerMethodField()

    class Meta:
        model = ChatSession
        fields = [
            "id",
            "visitor_id",
            "visitor_name",
            "visitor_email",
            "visitor_phone",
            "visitor_ip",
            "visitor_geo",
            "visitor_user_agent",
            "pages_visited",
            "referrer",
            "assigned_to",
            "assigned_to_email",
            "status",
            "related_module",
            "related_id",
            "started_at",
            "ended_at",
            "satisfaction_score",
            "transcript",
            "message_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "assigned_to_email",
            "started_at",
            "ended_at",
            "transcript",
            "message_count",
            "created_at",
            "updated_at",
        ]

    def get_message_count(self, obj: ChatSession) -> int:
        return obj.messages.count()  # type: ignore[attr-defined]


class CannedResponseSerializer(serializers.ModelSerializer):
    """Serializer for :class:`CannedResponse`."""

    class Meta:
        model = CannedResponse
        fields = [
            "id",
            "key",
            "body",
            "category",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ProactiveRuleSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ProactiveRule`."""

    class Meta:
        model = ProactiveRule
        fields = [
            "id",
            "name",
            "conditions",
            "message",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = [
    "CannedResponseSerializer",
    "ChatMessageSerializer",
    "ChatSessionSerializer",
    "ProactiveRuleSerializer",
]
