"""Database models for the reports app.

All four models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`Report` — a saved report definition (source model + fields +
  filters + group_by + aggregates + order_by + limit/offset + chart type
  + chart config + optional cron schedule + share list + folder).
* :class:`ReportFolder` — a tenant-scoped tree (self-referential parent)
  for organizing reports in the UI.
* :class:`ReportSubscription` — a user's opt-in to receive e-mailed
  results on each scheduled run (or on manual re-run).
* :class:`ReportExecution` — an audit row per run (status / row_count /
  execution_time_ms / result_data / error_message).
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — source models / report types / chart types / execution status
###############################################################################

SOURCE_LEAD = "lead"
SOURCE_CONTACT = "contact"
SOURCE_ACCOUNT = "account"
SOURCE_DEAL = "deal"
SOURCE_TASK = "task"
SOURCE_EVENT = "event"
SOURCE_CALL = "call"
SOURCE_ACTIVITY = "activity"
SOURCE_CHOICES = [
    (SOURCE_LEAD, "Lead"),
    (SOURCE_CONTACT, "Contact"),
    (SOURCE_ACCOUNT, "Account"),
    (SOURCE_DEAL, "Deal"),
    (SOURCE_TASK, "Task"),
    (SOURCE_EVENT, "Event"),
    (SOURCE_CALL, "Call"),
    (SOURCE_ACTIVITY, "Activity"),
]

REPORT_TABULAR = "tabular"
REPORT_SUMMARY = "summary"
REPORT_MATRIX = "matrix"
REPORT_JOINED = "joined"
REPORT_COHORT = "cohort"
REPORT_FUNNEL = "funnel"
REPORT_CROSS_SELL = "cross_sell"
REPORT_TYPE_CHOICES = [
    (REPORT_TABULAR, "Tabular"),
    (REPORT_SUMMARY, "Summary"),
    (REPORT_MATRIX, "Matrix"),
    (REPORT_JOINED, "Joined"),
    (REPORT_COHORT, "Cohort"),
    (REPORT_FUNNEL, "Funnel"),
    (REPORT_CROSS_SELL, "Cross-sell"),
]

CHART_BAR = "bar"
CHART_LINE = "line"
CHART_PIE = "pie"
CHART_FUNNEL = "funnel"
CHART_GAUGE = "gauge"
CHART_HEATMAP = "heatmap"
CHART_SCATTER = "scatter"
CHART_TREEMAP = "treemap"
CHART_SANKEY = "sankey"
CHART_RADAR = "radar"
CHART_WATERFALL = "waterfall"
CHART_NONE = "none"
CHART_TYPE_CHOICES = [
    (CHART_BAR, "Bar"),
    (CHART_LINE, "Line"),
    (CHART_PIE, "Pie"),
    (CHART_FUNNEL, "Funnel"),
    (CHART_GAUGE, "Gauge"),
    (CHART_HEATMAP, "Heatmap"),
    (CHART_SCATTER, "Scatter"),
    (CHART_TREEMAP, "Treemap"),
    (CHART_SANKEY, "Sankey"),
    (CHART_RADAR, "Radar"),
    (CHART_WATERFALL, "Waterfall"),
    (CHART_NONE, "None"),
]

EXEC_RUNNING = "running"
EXEC_COMPLETED = "completed"
EXEC_FAILED = "failed"
EXEC_STATUS_CHOICES = [
    (EXEC_RUNNING, "Running"),
    (EXEC_COMPLETED, "Completed"),
    (EXEC_FAILED, "Failed"),
]


###############################################################################
# Report
###############################################################################


class Report(TenantModel):
    """A saved report definition executed by :class:`reports.services.ReportService`.

    The ``fields`` / ``filters`` / ``group_by`` / ``order_by`` /
    ``aggregates`` / ``having`` JSON blobs together describe a query:

    * ``fields`` — ``[{"field": "name", "alias": "Name"}, ...]``.
    * ``filters`` — an AND/OR tree: ``{"op": "and", "children": [...]}``
      or a leaf ``{"field": "x", "op": "eq", "value": 1}``.
    * ``group_by`` — ``["industry", "owner_id"]``.
    * ``aggregates`` — ``[{"function": "sum", "field": "amount",
      "alias": "revenue"}, ...]``.
    * ``having`` — same shape as ``filters`` but applied post-aggregate.
    * ``order_by`` — ``[{"field": "revenue", "dir": "desc"}, ...]``.
    """

    name = models.CharField(max_length=255, db_index=True)
    description = models.TextField(blank=True, default="")
    source_model = models.CharField(max_length=32, choices=SOURCE_CHOICES, db_index=True)
    report_type = models.CharField(
        max_length=16, choices=REPORT_TYPE_CHOICES, default=REPORT_TABULAR
    )
    fields = models.JSONField(default=list, blank=True)
    filters = models.JSONField(default=dict, blank=True)
    group_by = models.JSONField(default=list, blank=True)
    order_by = models.JSONField(default=list, blank=True)
    aggregates = models.JSONField(default=list, blank=True)
    having = models.JSONField(default=dict, blank=True)
    limit = models.PositiveIntegerField(default=100)
    offset = models.PositiveIntegerField(default=0)
    chart_type = models.CharField(
        max_length=16, choices=CHART_TYPE_CHOICES, default=CHART_NONE
    )
    chart_config = models.JSONField(default=dict, blank=True)
    schedule_cron = models.CharField(max_length=128, blank=True, default="", db_index=True)
    shared_with = models.JSONField(default=list, blank=True)
    folder = models.ForeignKey(
        "ReportFolder",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reports",
        db_index=True,
    )
    is_active = models.BooleanField(default=True, db_index=True)
    is_published = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reports",
        db_index=True,
    )
    last_run_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "reports_report"
        verbose_name = "report"
        verbose_name_plural = "reports"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "is_active", "is_published"], name="report_active_pub_idx"),
            models.Index(fields=["tenant", "created_by"], name="report_creator_idx"),
        ]

    def __str__(self) -> str:
        return self.name


###############################################################################
# ReportFolder
###############################################################################


class ReportFolder(TenantModel):
    """A self-referential folder tree for organizing reports in the UI."""

    name = models.CharField(max_length=255)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
        db_index=True,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_folders",
        db_index=True,
    )

    class Meta:
        db_table = "reports_folder"
        verbose_name = "report folder"
        verbose_name_plural = "report folders"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["tenant", "parent"], name="report_folder_parent_idx"),
        ]

    def __str__(self) -> str:
        return self.name


###############################################################################
# ReportSubscription
###############################################################################


class ReportSubscription(TenantModel):
    """A user's opt-in to receive e-mailed report results.

    Triggered by :func:`reports.services.ReportService.schedule_report` (on
    the cron cadence) or by manual re-runs that opted into e-mail.
    """

    report = models.ForeignKey(
        Report,
        on_delete=models.CASCADE,
        related_name="subscriptions",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="report_subscriptions",
        db_index=True,
    )
    email_on_run = models.BooleanField(default=True)

    class Meta:
        db_table = "reports_subscription"
        verbose_name = "report subscription"
        verbose_name_plural = "report subscriptions"
        unique_together = (("report", "user"),)
        indexes = [
            models.Index(fields=["tenant", "user"], name="report_sub_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.report.name} ← {self.user.email}"


###############################################################################
# ReportExecution
###############################################################################


class ReportExecution(TenantModel):
    """An audit row for a single run of a :class:`Report`."""

    report = models.ForeignKey(
        Report,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="executions",
        db_index=True,
    )
    executed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_executions",
        db_index=True,
    )
    status = models.CharField(
        max_length=16, choices=EXEC_STATUS_CHOICES, default=EXEC_RUNNING, db_index=True
    )
    row_count = models.PositiveIntegerField(default=0)
    execution_time_ms = models.PositiveIntegerField(default=0)
    result_data = models.JSONField(null=True, blank=True)
    error_message = models.TextField(blank=True, default="")
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "reports_execution"
        verbose_name = "report execution"
        verbose_name_plural = "report executions"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["report", "started_at"], name="report_exec_started_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.report_id} / {self.status} @ {self.started_at:%Y-%m-%d %H:%M}"


__all__ = [
    "CHART_BAR",
    "CHART_FUNNEL",
    "CHART_GAUGE",
    "CHART_HEATMAP",
    "CHART_LINE",
    "CHART_NONE",
    "CHART_PIE",
    "CHART_RADAR",
    "CHART_SANKEY",
    "CHART_SCATTER",
    "CHART_TREEMAP",
    "CHART_TYPE_CHOICES",
    "CHART_WATERFALL",
    "EXEC_COMPLETED",
    "EXEC_FAILED",
    "EXEC_RUNNING",
    "EXEC_STATUS_CHOICES",
    "REPORT_COHORT",
    "REPORT_CROSS_SELL",
    "REPORT_FUNNEL",
    "REPORT_JOINED",
    "REPORT_MATRIX",
    "REPORT_SUMMARY",
    "REPORT_TABULAR",
    "REPORT_TYPE_CHOICES",
    "SOURCE_ACCOUNT",
    "SOURCE_ACTIVITY",
    "SOURCE_CALL",
    "SOURCE_CHOICES",
    "SOURCE_CONTACT",
    "SOURCE_DEAL",
    "SOURCE_EVENT",
    "SOURCE_LEAD",
    "SOURCE_TASK",
    "Report",
    "ReportExecution",
    "ReportFolder",
    "ReportSubscription",
]
