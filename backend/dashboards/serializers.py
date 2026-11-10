"""DRF serializers for the dashboards app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Dashboard, DashboardWidget


class DashboardWidgetSerializer(serializers.ModelSerializer):
    """Serializer for :class:`DashboardWidget`."""

    report_name = serializers.CharField(
        source="report.name", read_only=True, default=""
    )

    class Meta:
        model = DashboardWidget
        fields = [
            "id",
            "dashboard",
            "widget_type",
            "title",
            "report",
            "report_name",
            "position",
            "color_theme",
            "drill_down",
            "custom_config",
            "order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "report_name", "created_at", "updated_at"]


class DashboardSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Dashboard`.

    The list endpoint projects only the top-level fields (no widgets); the
    detail endpoint nests the widgets via :class:`DashboardWidgetSerializer`.
    """

    created_by_email = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )
    widgets = DashboardWidgetSerializer(many=True, read_only=True)

    class Meta:
        model = Dashboard
        fields = [
            "id",
            "name",
            "layout",
            "filters",
            "refresh_interval",
            "shared_with",
            "is_default",
            "created_by",
            "created_by_email",
            "widgets",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_by_email", "created_at", "updated_at"]


__all__ = ["DashboardSerializer", "DashboardWidgetSerializer"]
