"""DRF serializers for the notifications app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Notification, NotificationPreference, QuietHours


class NotificationSerializer(serializers.ModelSerializer):
    """Serializer for :class:`notifications.models.Notification`.

    ``actor_name`` and ``actor_avatar_url`` are computed from the FK
    ``actor`` so the frontend can render without a second fetch.
    """

    actor_name = serializers.SerializerMethodField()
    actor_avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "actor",
            "actor_name",
            "actor_avatar_url",
            "verb",
            "target_module",
            "target_id",
            "target_name",
            "recipient",
            "read_at",
            "channel",
            "data",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "actor",
            "actor_name",
            "actor_avatar_url",
            "verb",
            "target_module",
            "target_id",
            "target_name",
            "recipient",
            "read_at",
            "channel",
            "data",
            "created_at",
        ]

    def get_actor_name(self, obj: Notification) -> str:
        if obj.actor is None:
            return "Foundation"
        return obj.actor.name or obj.actor.email

    def get_actor_avatar_url(self, obj: Notification) -> str:
        if obj.actor is None:
            return ""
        profile = getattr(obj.actor, "profile", None)
        return profile.avatar_url if profile else ""


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    """Serializer for :class:`notifications.models.NotificationPreference`."""

    class Meta:
        model = NotificationPreference
        fields = [
            "id",
            "user",
            "notification_type",
            "in_app",
            "email",
            "push",
            "sms",
            "digest_mode",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]


class QuietHoursSerializer(serializers.ModelSerializer):
    """Serializer for :class:`notifications.models.QuietHours`."""

    class Meta:
        model = QuietHours
        fields = [
            "id",
            "user",
            "start_time",
            "end_time",
            "timezone",
            "enabled",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]
