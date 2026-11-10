"""DRF serializers for the scheduled_actions app."""

from __future__ import annotations

from rest_framework import serializers

from scheduled_actions.models import ScheduledJob, ScheduledJobLog


class ScheduledJobSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ScheduledJob`."""

    class Meta:
        model = ScheduledJob
        fields = [
            "id",
            "name",
            "cron_expression",
            "action_type",
            "config",
            "last_run_at",
            "next_run_at",
            "status",
            "timezone",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "last_run_at", "next_run_at", "created_at", "updated_at"]

    def validate_cron_expression(self, value: str) -> str:
        if not value or value.count(" ") < 4:
            raise serializers.ValidationError(
                "cron_expression must be a 5-field UNIX cron string."
            )
        return value


class ScheduledJobLogSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`ScheduledJobLog`."""

    job_name = serializers.CharField(source="job.name", read_only=True, default="")

    class Meta:
        model = ScheduledJobLog
        fields = [
            "id",
            "job",
            "job_name",
            "started_at",
            "completed_at",
            "status",
            "error_message",
            "result",
            "created_at",
        ]
        read_only_fields = fields


__all__ = ["ScheduledJobLogSerializer", "ScheduledJobSerializer"]
