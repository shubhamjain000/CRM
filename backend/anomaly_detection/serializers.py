"""DRF serializers for the anomaly_detection app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Anomaly


class AnomalySerializer(serializers.ModelSerializer):
    """Serializer for :class:`Anomaly`."""

    acknowledged_by_email = serializers.CharField(
        source="acknowledged_by.email", read_only=True, default=""
    )

    class Meta:
        model = Anomaly
        fields = [
            "id",
            "record_type",
            "record_id",
            "anomaly_type",
            "severity",
            "description",
            "acknowledged_by",
            "acknowledged_by_email",
            "acknowledged_at",
            "status",
            "detected_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "acknowledged_by",
            "acknowledged_by_email",
            "acknowledged_at",
            "status",
            "detected_at",
            "created_at",
            "updated_at",
        ]


__all__ = ["AnomalySerializer"]
