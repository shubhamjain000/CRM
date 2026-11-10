"""DRF serializers for the data_security app."""

from __future__ import annotations

from rest_framework import serializers

from .models import DataClassification, RetentionPolicy


class DataClassificationSerializer(serializers.ModelSerializer):
    """Serializer for :class:`DataClassification`."""

    class Meta:
        model = DataClassification
        fields = [
            "id",
            "model",
            "field",
            "classification",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class RetentionPolicySerializer(serializers.ModelSerializer):
    """Serializer for :class:`RetentionPolicy`."""

    class Meta:
        model = RetentionPolicy
        fields = [
            "id",
            "model",
            "retention_days",
            "action",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = ["DataClassificationSerializer", "RetentionPolicySerializer"]
