"""Task model — productivity tasks with RRULE recurrence, reminders, and timers.

Design notes
------------
* Inherits :class:`api.soft_delete.SoftDeleteTenantModel` → tenant FK
  (``CASCADE``), ``created_at`` / ``updated_at``, ``deleted_at``, and the
  ``objects`` / ``all_objects`` managers (soft-delete aware).
* ``parent_task`` is a self-FK for subtasks (``RESTRICT``).
* ``assignee`` / ``owner`` / ``created_by`` point at the tenant's users
  (``RESTRICT`` for owner/assignee, ``SET_NULL`` for created_by).
* ``checklist`` and ``tags`` are stored as JSONField lists — no schema
  enforcement at the DB layer, validated by the serializer.
* ``recurrence`` stores an `RRULE <https://datatracker.ietf.org/doc/html/rfc5545>`_
  string (e.g. ``FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1``). Expansion is handled
  by :mod:`tasks.tasks` (daily beat) via :mod:`dateutil.rrule`.
* ``reminder_sent_at`` is set by the beat task to make reminder dispatch
  idempotent.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import User
from api.soft_delete import SoftDeleteTenantModel


class Task(SoftDeleteTenantModel):
    """A productivity task — optionally recurring, with reminders + timers."""

    PRIORITY_LOW = "low"
    PRIORITY_MEDIUM = "medium"
    PRIORITY_HIGH = "high"
    PRIORITY_URGENT = "urgent"
    PRIORITY_CHOICES = [
        (PRIORITY_LOW, "Low"),
        (PRIORITY_MEDIUM, "Medium"),
        (PRIORITY_HIGH, "High"),
        (PRIORITY_URGENT, "Urgent"),
    ]

    STATUS_NOT_STARTED = "not_started"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_COMPLETED = "completed"
    STATUS_DEFERRED = "deferred"
    STATUS_CHOICES = [
        (STATUS_NOT_STARTED, "Not started"),
        (STATUS_IN_PROGRESS, "In progress"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_DEFERRED, "Deferred"),
    ]

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    due_date = models.DateTimeField(null=True, blank=True, db_index=True)
    reminder = models.DateTimeField(null=True, blank=True)
    reminder_sent_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Set by the send_task_reminders beat task; null = not yet sent.",
    )
    priority = models.CharField(
        max_length=16, choices=PRIORITY_CHOICES, default=PRIORITY_MEDIUM, db_index=True
    )
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_NOT_STARTED, db_index=True
    )
    assignee = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="assigned_tasks",
        db_index=True,
    )
    watchers = models.ManyToManyField(
        User,
        related_name="watched_tasks",
        blank=True,
    )
    related_module = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="CRM module this task relates to (lead/contact/account/deal) if any.",
    )
    related_id = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
    )
    recurrence = models.TextField(
        blank=True,
        default="",
        help_text="RFC 5545 RRULE string. Empty = one-off task.",
    )
    parent_task = models.ForeignKey(
        "self",
        on_delete=models.RESTRICT,
        related_name="subtasks",
        null=True,
        blank=True,
        db_index=True,
    )
    time_spent = models.BigIntegerField(
        default=0,
        help_text="Accumulated time spent on this task, in seconds.",
    )
    timer_started_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Set when start_timer is called; cleared on stop_timer.",
    )
    checklist = models.JSONField(
        default=list,
        blank=True,
        help_text="List of {text, done} items.",
    )
    tags = models.JSONField(
        default=list,
        blank=True,
        help_text="List of free-form tag strings.",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_tasks",
    )
    owner = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="owned_tasks",
    )
    last_activity = models.DateTimeField(null=True, blank=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "tasks_task"
        verbose_name = "task"
        verbose_name_plural = "tasks"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(priority__in=("low", "medium", "high", "urgent")),
                name="tasks_priority_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=("not_started", "in_progress", "completed", "deferred")
                ),
                name="tasks_status_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="tasks_tenant_deleted_idx"),
            models.Index(fields=["tenant", "assignee", "status"], name="tasks_assignee_status_idx"),
            models.Index(fields=["tenant", "due_date"], name="tasks_due_date_idx"),
            models.Index(fields=["tenant", "owner", "status"], name="tasks_owner_status_idx"),
            models.Index(fields=["tenant", "last_activity"], name="tasks_last_activity_idx"),
        ]

    def __str__(self) -> str:
        return self.title or f"Task #{self.pk}"

    # ------------------------------------------------------------------ helpers

    def touch(self) -> None:
        """Bump ``last_activity`` to now."""
        self.last_activity = timezone.now()
        self.save(update_fields=["last_activity", "updated_at"])

    def mark_complete(self) -> None:
        """Set status to ``completed`` and stamp ``completed_at``."""
        self.status = self.STATUS_COMPLETED
        self.completed_at = timezone.now()
        self.last_activity = self.completed_at
        self.save(update_fields=["status", "completed_at", "last_activity", "updated_at"])

    def mark_deferred(self) -> None:
        """Set status to ``deferred``."""
        self.status = self.STATUS_DEFERRED
        self.last_activity = timezone.now()
        self.save(update_fields=["status", "last_activity", "updated_at"])

    def mark_reminded(self) -> None:
        """Stamp ``reminder_sent_at`` so the beat task doesn't re-fire."""
        self.reminder_sent_at = timezone.now()
        self.save(update_fields=["reminder_sent_at", "updated_at"])
