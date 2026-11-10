"""DRF serializers for the sandbox app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Sandbox


class SandboxSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Sandbox`."""

    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = Sandbox
        fields = [
            "id",
            "branch_name",
            "description",
            "snapshot_data",
            "expires_at",
            "is_active",
            "is_expired",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_expired", "created_at", "updated_at"]


__all__ = ["SandboxSerializer"]
