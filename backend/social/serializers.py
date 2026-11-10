"""DRF serializers for the social app."""

from __future__ import annotations

from rest_framework import serializers

from .models import ScheduledPost, SocialAccount, SocialMention


class SocialAccountSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SocialAccount` — ``access_token`` is write-only."""

    class Meta:
        model = SocialAccount
        fields = [
            "id",
            "provider",
            "handle",
            "access_token",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"access_token": {"write_only": True}}


class SocialMentionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SocialMention`."""

    account_handle = serializers.CharField(
        source="account.handle", read_only=True, default=""
    )
    assigned_to_email = serializers.CharField(
        source="assigned_to.email", read_only=True, default=""
    )

    class Meta:
        model = SocialMention
        fields = [
            "id",
            "account",
            "account_handle",
            "provider",
            "message_id",
            "author",
            "author_handle",
            "body",
            "media",
            "url",
            "sentiment",
            "is_read",
            "assigned_to",
            "assigned_to_email",
            "related_module",
            "related_id",
            "created_at",
            "responded_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "account_handle",
            "assigned_to_email",
            "message_id",
            "author",
            "author_handle",
            "body",
            "media",
            "url",
            "sentiment",
            "created_at",
            "responded_at",
            "updated_at",
        ]


class ScheduledPostSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ScheduledPost`."""

    account_handle = serializers.CharField(
        source="account.handle", read_only=True, default=""
    )

    class Meta:
        model = ScheduledPost
        fields = [
            "id",
            "account",
            "account_handle",
            "content",
            "media",
            "scheduled_at",
            "status",
            "posted_at",
            "error_message",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "account_handle",
            "status",
            "posted_at",
            "error_message",
            "created_at",
            "updated_at",
        ]


__all__ = [
    "ScheduledPostSerializer",
    "SocialAccountSerializer",
    "SocialMentionSerializer",
]
