"""DRF serializers for the security_monitoring app."""

from __future__ import annotations

from rest_framework import serializers

from .models import SecurityAlert, SecurityEvent


class SecurityEventSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SecurityEvent`."""

    class Meta:
        model = SecurityEvent
        fields = [
            "id",
            "event_type",
            "severity",
            "description",
            "ip",
            "metadata",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class SecurityAlertSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SecurityAlert`."""

    class Meta:
        model = SecurityAlert
        fields = [
            "id",
            "event",
            "status",
            "acknowledged_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = ["SecurityEventSerializer", "SecurityAlertSerializer"]
