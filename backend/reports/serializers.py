"""DRF serializers for the reports app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Report, ReportExecution, ReportFolder, ReportSubscription


class ReportFolderSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ReportFolder`."""

    created_by_email = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )

    class Meta:
        model = ReportFolder
        fields = [
            "id",
            "name",
            "parent",
            "created_by",
            "created_by_email",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_by_email", "created_at", "updated_at"]


class ReportSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Report`."""

    created_by_email = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )
    folder_name = serializers.CharField(
        source="folder.name", read_only=True, default=""
    )

    class Meta:
        model = Report
        fields = [
            "id",
            "name",
            "description",
            "source_model",
            "report_type",
            "fields",
            "filters",
            "group_by",
            "order_by",
            "aggregates",
            "having",
            "limit",
            "offset",
            "chart_type",
            "chart_config",
            "schedule_cron",
            "shared_with",
            "folder",
            "folder_name",
            "is_active",
            "is_published",
            "created_by",
            "created_by_email",
            "last_run_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_by_email",
            "folder_name",
            "last_run_at",
            "created_at",
            "updated_at",
        ]


class ReportSubscriptionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ReportSubscription`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = ReportSubscription
        fields = [
            "id",
            "report",
            "user",
            "user_email",
            "email_on_run",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "user_email", "created_at", "updated_at"]


class ReportExecutionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ReportExecution`."""

    executed_by_email = serializers.CharField(
        source="executed_by.email", read_only=True, default=""
    )
    report_name = serializers.CharField(source="report.name", read_only=True, default="")

    class Meta:
        model = ReportExecution
        fields = [
            "id",
            "report",
            "report_name",
            "executed_by",
            "executed_by_email",
            "status",
            "row_count",
            "execution_time_ms",
            "result_data",
            "error_message",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "executed_by",
            "executed_by_email",
            "report_name",
            "status",
            "row_count",
            "execution_time_ms",
            "result_data",
            "error_message",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]


__all__ = [
    "ReportExecutionSerializer",
    "ReportFolderSerializer",
    "ReportSerializer",
    "ReportSubscriptionSerializer",
]
