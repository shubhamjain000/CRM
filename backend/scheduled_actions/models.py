"""Scheduled-actions models — cron-driven recurring jobs.

Design notes
------------
* Both models inherit :class:`api.models.TenantModel` (tenant FK +
  ``created_at`` / ``updated_at``) and are filtered through
  :class:`api.managers.TenantManager`.
* :class:`ScheduledJob` stores a ``cron_expression`` (5-field UNIX cron,
  e.g. ``"0 9 * * 1"`` = every Monday 09:00). The
  :func:`scheduled_actions.tasks.run_scheduled_jobs` beat task uses
  :mod:`croniter` to compute ``next_run_at``.
* :class:`ScheduledJobLog` is the append-only audit trail.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel


###############################################################################
# Constants
###############################################################################


STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
STATUS_CHOICES = [
    (STATUS_ACTIVE, "Active"),
    (STATUS_PAUSED, "Paused"),
]

LOG_STATUS_SUCCESS = "success"
LOG_STATUS_FAILED = "failed"
LOG_STATUS_CHOICES = [
    (LOG_STATUS_SUCCESS, "Success"),
    (LOG_STATUS_FAILED, "Failed"),
]


###############################################################################
# ScheduledJob
###############################################################################


class ScheduledJob(TenantModel):
    """A tenant-scoped recurring job.

    The Celery beat task :func:`scheduled_actions.tasks.run_scheduled_jobs`
    runs every minute and finds every ``status=active`` job whose
    ``next_run_at <= now``. For each, it dispatches the configured action
    (re-using :class:`workflows.services.WorkflowService.execute_action`)
    and re-computes ``next_run_at`` from the cron expression.
    """

    name = models.CharField(max_length=255, db_index=True)
    cron_expression = models.CharField(
        max_length=128,
        help_text="5-field UNIX cron, e.g. '0 9 * * 1' = every Monday 09:00.",
    )
    action_type = models.CharField(
        max_length=32,
        help_text="Workflow action type to run (send_email / create_task / ...).",
    )
    config = models.JSONField(
        default=dict,
        blank=True,
        help_text="Type-specific configuration payload (same shape as WorkflowAction.config).",
    )
    last_run_at = models.DateTimeField(null=True, blank=True)
    next_run_at = models.DateTimeField(null=True, blank=True, db_index=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE, db_index=True
    )
    timezone = models.CharField(max_length=64, default="UTC")

    class Meta:
        db_table = "scheduled_actions_scheduledjob"
        verbose_name = "scheduled job"
        verbose_name_plural = "scheduled jobs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "status", "next_run_at"],
                name="schjob_status_nextrun_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.cron_expression})"


###############################################################################
# ScheduledJobLog
###############################################################################


class ScheduledJobLog(TenantModel):
    """Append-only audit trail of every scheduled-job run."""

    job = models.ForeignKey(
        ScheduledJob,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="logs",
        db_index=True,
    )
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=LOG_STATUS_CHOICES, db_index=True)
    error_message = models.TextField(blank=True, default="")
    result = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "scheduled_actions_scheduledjoblog"
        verbose_name = "scheduled job log"
        verbose_name_plural = "scheduled job logs"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["job", "started_at"], name="schjoblog_job_started_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.job} → {self.status} @ {self.started_at:%Y-%m-%d %H:%M}"


__all__ = [
    "LOG_STATUS_CHOICES",
    "LOG_STATUS_FAILED",
    "LOG_STATUS_SUCCESS",
    "STATUS_ACTIVE",
    "STATUS_CHOICES",
    "STATUS_PAUSED",
    "ScheduledJob",
    "ScheduledJobLog",
]
