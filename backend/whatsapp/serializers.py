"""DRF serializers for the whatsapp app."""

from __future__ import annotations

from rest_framework import serializers

from .models import WhatsAppAccount, WhatsAppMessage, WhatsAppTemplate


class WhatsAppAccountSerializer(serializers.ModelSerializer):
    """Serializer for :class:`WhatsAppAccount`.

    ``access_token`` is write-only — it never appears in API responses.
    """

    class Meta:
        model = WhatsAppAccount
        fields = [
            "id",
            "phone_number_id",
            "waba_id",
            "access_token",
            "display_name",
            "display_phone_number",
            "quality_rating",
            "is_verified",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "quality_rating", "is_verified", "created_at", "updated_at"]
        extra_kwargs = {"access_token": {"write_only": True}}


class WhatsAppMessageSerializer(serializers.ModelSerializer):
    """Serializer for :class:`WhatsAppMessage`."""

    account_phone = serializers.CharField(
        source="account.display_phone_number", read_only=True, default=""
    )

    class Meta:
        model = WhatsAppMessage
        fields = [
            "id",
            "account",
            "account_phone",
            "from_phone",
            "to_phone",
            "body",
            "media_file",
            "message_type",
            "status",
            "direction",
            "related_module",
            "related_id",
            "template_id",
            "error_code",
            "error_message",
            "timestamp",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "account",
            "account_phone",
            "from_phone",
            "status",
            "error_code",
            "error_message",
            "timestamp",
            "created_at",
            "updated_at",
        ]


class WhatsAppTemplateSerializer(serializers.ModelSerializer):
    """Serializer for :class:`WhatsAppTemplate`."""

    class Meta:
        model = WhatsAppTemplate
        fields = [
            "id",
            "name",
            "language",
            "category",
            "body",
            "header_type",
            "header_text",
            "footer_text",
            "buttons",
            "is_approved",
            "template_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_approved", "template_id", "created_at", "updated_at"]


__all__ = [
    "WhatsAppAccountSerializer",
    "WhatsAppMessageSerializer",
    "WhatsAppTemplateSerializer",
]
