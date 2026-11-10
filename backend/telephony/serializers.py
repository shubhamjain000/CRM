"""DRF serializers for the telephony app."""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    IvrFlow,
    PhoneNumber,
    SmsMessage,
    SmsTemplate,
    TelephonyCall,
)


class PhoneNumberSerializer(serializers.ModelSerializer):
    """Serializer for :class:`PhoneNumber`."""

    class Meta:
        model = PhoneNumber
        fields = [
            "id",
            "number",
            "provider",
            "capabilities",
            "is_active",
            "region",
            "assigned_to_type",
            "assigned_to_id",
            "friendly_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TelephonyCallSerializer(serializers.ModelSerializer):
    """Serializer for :class:`TelephonyCall`."""

    class Meta:
        model = TelephonyCall
        fields = [
            "id",
            "from_number",
            "to_number",
            "direction",
            "status",
            "duration",
            "recording_url",
            "transcription",
            "sentiment",
            "related_module",
            "related_id",
            "owner_id",
            "voip_provider",
            "voip_call_id",
            "started_at",
            "ended_at",
            "notes",
            "outcome",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "voip_call_id",
            "started_at",
            "ended_at",
            "created_at",
            "updated_at",
        ]


class SmsTemplateSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SmsTemplate`."""

    class Meta:
        model = SmsTemplate
        fields = [
            "id",
            "name",
            "body",
            "variables",
            "category",
            "is_approved",
            "dlt_template_id",
            "max_length",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class SmsMessageSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SmsMessage`."""

    class Meta:
        model = SmsMessage
        fields = [
            "id",
            "from_number",
            "to_number",
            "body",
            "direction",
            "status",
            "template",
            "related_module",
            "related_id",
            "segments",
            "cost",
            "sent_at",
            "delivered_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "segments",
            "cost",
            "sent_at",
            "delivered_at",
            "created_at",
            "updated_at",
        ]


class IvrFlowSerializer(serializers.ModelSerializer):
    """Serializer for :class:`IvrFlow`."""

    class Meta:
        model = IvrFlow
        fields = [
            "id",
            "name",
            "config",
            "phone_number",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = [
    "IvrFlowSerializer",
    "PhoneNumberSerializer",
    "SmsMessageSerializer",
    "SmsTemplateSerializer",
    "TelephonyCallSerializer",
]
