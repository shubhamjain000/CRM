"""DRF serializers for the forecasting app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Forecast, ForecastAdjustment


class ForecastAdjustmentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ForecastAdjustment`."""

    adjusted_by_email = serializers.CharField(
        source="adjusted_by.email", read_only=True, default=""
    )

    class Meta:
        model = ForecastAdjustment
        fields = [
            "id",
            "forecast",
            "adjusted_by",
            "adjusted_by_email",
            "old_amount",
            "new_amount",
            "reason",
            "created_at",
        ]
        read_only_fields = ["id", "adjusted_by", "adjusted_by_email", "created_at"]


class ForecastSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Forecast`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")
    approved_by_email = serializers.CharField(
        source="approved_by.email", read_only=True, default=""
    )
    effective_amount = serializers.DecimalField(
        max_digits=18, decimal_places=2, read_only=True
    )

    class Meta:
        model = Forecast
        fields = [
            "id",
            "user",
            "user_email",
            "period_type",
            "period_start",
            "period_end",
            "category",
            "amount",
            "override_amount",
            "effective_amount",
            "notes",
            "submitted_at",
            "approved_by",
            "approved_by_email",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "user_email",
            "approved_by_email",
            "effective_amount",
            "amount",
            "submitted_at",
            "approved_by",
            "approved_at",
            "created_at",
            "updated_at",
        ]


__all__ = ["ForecastAdjustmentSerializer", "ForecastSerializer"]
