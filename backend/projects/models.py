"""Database models for the projects app (Phase 19).

Three tenant-scoped models: :class:`Project`, :class:`ProjectTask`,
:class:`TimeEntry`.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

# Project status
PRJ_ACTIVE = "active"
PRJ_COMPLETED = "completed"
PRJ_ON_HOLD = "on_hold"
PROJECT_STATUS_CHOICES = [
    (PRJ_ACTIVE, "active"),
    (PRJ_COMPLETED, "completed"),
    (PRJ_ON_HOLD, "on_hold"),
]

# Task status — kept loose (char) per brief; no fixed choice set.
TASK_DEFAULT_STATUS = "open"


class Project(TenantModel):
    """A tenant-scoped project."""

    name = models.CharField(max_length=255, db_index=True)
    description = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16, choices=PROJECT_STATUS_CHOICES, default=PRJ_ACTIVE, db_index=True
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_projects",
    )

    class Meta:
        db_table = "projects_project"
        verbose_name = "project"
        verbose_name_plural = "projects"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="prj_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Project: {self.name}"


class ProjectTask(TenantModel):
    """A task inside a :class:`Project`."""

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="tasks",
    )
    title = models.CharField(max_length=255, db_index=True)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=32, default=TASK_DEFAULT_STATUS, db_index=True)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_tasks",
    )
    due_date = models.DateField(null=True, blank=True)
    estimated_hours = models.DecimalField(
        max_digits=10, decimal_places=2, default=0
    )
    actual_hours = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        db_table = "projects_projecttask"
        verbose_name = "project task"
        verbose_name_plural = "project tasks"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "project"], name="pt_project_idx"),
            models.Index(fields=["tenant", "status"], name="pt_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Task: {self.title} (Project {self.project_id})"


class TimeEntry(TenantModel):
    """A logged time slice against a :class:`Project` (+ optional task)."""

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="time_entries",
    )
    task = models.ForeignKey(
        ProjectTask,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="time_entries",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="time_entries",
    )
    hours = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    description = models.TextField(blank=True, default="")
    date = models.DateField(db_index=True)
    is_billable = models.BooleanField(default=False)

    class Meta:
        db_table = "projects_timeentry"
        verbose_name = "time entry"
        verbose_name_plural = "time entries"
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["tenant", "project"], name="te_project_idx"),
            models.Index(fields=["tenant", "user"], name="te_user_idx"),
        ]

    def __str__(self) -> str:
        return f"TimeEntry {self.hours}h on Project {self.project_id}"


__all__ = [
    "Project",
    "ProjectTask",
    "TimeEntry",
    "PRJ_ACTIVE",
    "PRJ_COMPLETED",
    "PRJ_ON_HOLD",
    "PROJECT_STATUS_CHOICES",
    "TASK_DEFAULT_STATUS",
]
