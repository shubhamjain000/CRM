"""DRF serializers for the lead_scoring app."""

from __future__ import annotations

from rest_framework import serializers

from .models import LeadScore


class LeadScoreSerializer(serializers.ModelSerializer):
    """Serializer for :class:`LeadScore`."""

    class Meta:
        model = LeadScore
        fields = [
            "id",
            "lead_id",
            "score",
            "factors",
            "model_version",
            "calculated_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "score",
            "factors",
            "model_version",
            "calculated_at",
            "created_at",
            "updated_at",
        ]


__all__ = ["LeadScoreSerializer"]
