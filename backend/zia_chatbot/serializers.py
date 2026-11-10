"""DRF serializers for the zia_chatbot app."""

from __future__ import annotations

from rest_framework import serializers

from .models import ZiaConversation


class ZiaConversationSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ZiaConversation`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = ZiaConversation
        fields = [
            "id",
            "user",
            "user_email",
            "messages",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "user_email",
            "messages",
            "created_at",
            "updated_at",
        ]


class SendMessageSerializer(serializers.Serializer):
    """Input serializer for the ``send_message`` action."""

    message = serializers.CharField()

    class Meta:
        fields = ["message"]


__all__ = ["SendMessageSerializer", "ZiaConversationSerializer"]
