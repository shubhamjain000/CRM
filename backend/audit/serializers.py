"""DRF serializers for the audit app."""

from __future__ import annotations

from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    """Serializer for :class:`AuditLog` — every field is read-only."""

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor_id",
            "action",
            "target_type",
            "target_id",
            "changes",
            "ip",
            "user_agent",
            "timestamp",
            "created_at",
        ]
        read_only_fields = fields


__all__ = ["AuditLogSerializer"]
