"""DRF serializers for the analytics app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Dashboard, DashboardWidget


class DashboardWidgetSerializer(serializers.ModelSerializer):
    """Serializer for :class:`DashboardWidget`."""

    report_name = serializers.CharField(source="report.name", read_only=True, default="")

    class Meta:
        model = DashboardWidget
        fields = [
            "id",
            "dashboard",
            "title",
            "widget_type",
            "report",
            "report_name",
            "config",
            "order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "report_name", "created_at", "updated_at"]


class DashboardSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Dashboard`."""

    created_by_email = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )
    widget_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Dashboard
        fields = [
            "id",
            "name",
            "config",
            "is_default",
            "created_by",
            "created_by_email",
            "widget_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_by_email",
            "widget_count",
            "created_at",
            "updated_at",
        ]

    def to_representation(self, instance: Dashboard) -> dict:  # type: ignore[override]
        ret = super().to_representation(instance)
        # Avoid N+1 — only annotate when this is a single-object retrieval.
        if hasattr(instance, "_widget_count"):
            ret["widget_count"] = instance._widget_count  # type: ignore[attr-defined]
        else:
            ret["widget_count"] = instance.widgets.count()
        return ret


__all__ = ["DashboardSerializer", "DashboardWidgetSerializer"]
