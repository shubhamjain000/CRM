"""DRF serializers for the access_control app."""

from __future__ import annotations

from rest_framework import serializers

from .models import IPAllowlist, SessionPolicy, TrustedDevice


class IPAllowlistSerializer(serializers.ModelSerializer):
    """Serializer for :class:`IPAllowlist`."""

    class Meta:
        model = IPAllowlist
        fields = ["id", "cidr", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class SessionPolicySerializer(serializers.ModelSerializer):
    """Serializer for :class:`SessionPolicy`."""

    class Meta:
        model = SessionPolicy
        fields = ["id", "timeout_minutes", "max_concurrent", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class TrustedDeviceSerializer(serializers.ModelSerializer):
    """Serializer for :class:`TrustedDevice`."""

    class Meta:
        model = TrustedDevice
        fields = ["id", "user", "device_id", "last_seen", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = [
    "IPAllowlistSerializer",
    "SessionPolicySerializer",
    "TrustedDeviceSerializer",
]
