"""DRF serializers for the email_integration app."""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    Email,
    EmailAccount,
    EmailSignature,
    EmailThread,
    EmailTracking,
    MailMergeCampaign,
)


class EmailAccountSerializer(serializers.ModelSerializer):
    """Serializer for :class:`EmailAccount`.

    ``credentials`` is write-only — it never appears in API responses.
    """

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = EmailAccount
        fields = [
            "id",
            "user",
            "user_email",
            "provider",
            "email_address",
            "credentials",
            "sync_enabled",
            "sync_frequency",
            "last_synced_at",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "user_email", "last_synced_at", "created_at", "updated_at"]
        extra_kwargs = {"credentials": {"write_only": True}}


class EmailThreadSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`EmailThread`."""

    class Meta:
        model = EmailThread
        fields = [
            "id",
            "subject",
            "related_module",
            "related_id",
            "last_activity_at",
            "email_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class EmailSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Email`."""

    account_email = serializers.CharField(
        source="account.email_address", read_only=True, default=""
    )

    class Meta:
        model = Email
        fields = [
            "id",
            "account",
            "account_email",
            "thread",
            "message_id",
            "from_address",
            "to_addresses",
            "cc",
            "bcc",
            "subject",
            "body_html",
            "body_text",
            "attachments",
            "direction",
            "status",
            "related_module",
            "related_id",
            "is_starred",
            "is_important",
            "has_attachments",
            "labels",
            "received_at",
            "sent_at",
            "opened_at",
            "clicked_at",
            "bounced_at",
            "bounce_reason",
            "scheduled_at",
            "snoozed_until",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "account",
            "account_email",
            "thread",
            "message_id",
            "from_address",
            "has_attachments",
            "received_at",
            "sent_at",
            "opened_at",
            "clicked_at",
            "bounced_at",
            "bounce_reason",
            "created_at",
            "updated_at",
        ]


class EmailSignatureSerializer(serializers.ModelSerializer):
    """Serializer for :class:`EmailSignature`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = EmailSignature
        fields = [
            "id",
            "user",
            "user_email",
            "name",
            "body_html",
            "is_default",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "user_email", "created_at", "updated_at"]


class EmailTrackingSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`EmailTracking`."""

    class Meta:
        model = EmailTracking
        fields = [
            "id",
            "email",
            "event",
            "url",
            "ip",
            "user_agent",
            "timestamp",
            "created_at",
        ]
        read_only_fields = fields


class MailMergeCampaignSerializer(serializers.ModelSerializer):
    """Serializer for :class:`MailMergeCampaign`."""

    created_by_email = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )

    class Meta:
        model = MailMergeCampaign
        fields = [
            "id",
            "name",
            "template_subject",
            "template_body_html",
            "recipients",
            "status",
            "sent_count",
            "failed_count",
            "created_by",
            "created_by_email",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "sent_count",
            "failed_count",
            "created_by",
            "created_by_email",
            "created_at",
            "updated_at",
        ]


__all__ = [
    "EmailAccountSerializer",
    "EmailSerializer",
    "EmailSignatureSerializer",
    "EmailThreadSerializer",
    "EmailTrackingSerializer",
    "MailMergeCampaignSerializer",
]
