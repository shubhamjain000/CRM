"""DRF serializers for the native_integrations app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Integration, IntegrationLog


class IntegrationSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Integration`."""

    class Meta:
        model = Integration
        fields = [
            "id",
            "provider",
            "is_connected",
            "config",
            "last_synced_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "last_synced_at", "created_at", "updated_at"]


class IntegrationLogSerializer(serializers.ModelSerializer):
    """Serializer for :class:`IntegrationLog`."""

    class Meta:
        model = IntegrationLog
        fields = [
            "id",
            "integration",
            "event",
            "status",
            "details",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


__all__ = ["IntegrationLogSerializer", "IntegrationSerializer"]
