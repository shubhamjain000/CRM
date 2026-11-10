"""DRF serializers for the deal_prediction app."""

from __future__ import annotations

from rest_framework import serializers

from .models import PredictedDealValue


class PredictedDealValueSerializer(serializers.ModelSerializer):
    """Serializer for :class:`PredictedDealValue`."""

    class Meta:
        model = PredictedDealValue
        fields = [
            "id",
            "deal_id",
            "expected_value",
            "close_probability",
            "expected_close_date",
            "factors",
            "model_version",
            "calculated_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "expected_value",
            "close_probability",
            "expected_close_date",
            "factors",
            "model_version",
            "calculated_at",
            "created_at",
            "updated_at",
        ]


__all__ = ["PredictedDealValueSerializer"]
