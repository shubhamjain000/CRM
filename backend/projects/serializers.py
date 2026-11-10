"""DRF serializers for the projects app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Project, ProjectTask, TimeEntry


class ProjectSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Project`."""

    manager_email = serializers.CharField(source="manager.email", read_only=True, default="")

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "description",
            "status",
            "start_date",
            "end_date",
            "manager",
            "manager_email",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ProjectTaskSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ProjectTask`."""

    assignee_email = serializers.CharField(
        source="assignee.email", read_only=True, default=""
    )

    class Meta:
        model = ProjectTask
        fields = [
            "id",
            "project",
            "title",
            "description",
            "status",
            "assignee",
            "assignee_email",
            "due_date",
            "estimated_hours",
            "actual_hours",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TimeEntrySerializer(serializers.ModelSerializer):
    """Serializer for :class:`TimeEntry`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = TimeEntry
        fields = [
            "id",
            "project",
            "task",
            "user",
            "user_email",
            "hours",
            "description",
            "date",
            "is_billable",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = ["ProjectSerializer", "ProjectTaskSerializer", "TimeEntrySerializer"]
