"""Database models for the anomaly_detection app (Phase 18).

One tenant-scoped model:

* :class:`Anomaly` — a single detected anomaly. ``record_type`` /
  ``record_id`` are the polymorphic target (e.g. ``("deal", 42)``).
  ``severity`` ∈ {low, medium, high, critical}; ``status`` ∈ {open,
  acknowledged, resolved}. ``acknowledged_by`` / ``acknowledged_at`` are
  set by the ``acknowledge`` viewset action; ``resolved`` is a terminal
  state set by the ``resolve`` action.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from api.models import TenantModel

SEVERITY_LOW = "low"
SEVERITY_MEDIUM = "medium"
SEVERITY_HIGH = "high"
SEVERITY_CRITICAL = "critical"
SEVERITY_CHOICES = [
    (SEVERITY_LOW, "Low"),
    (SEVERITY_MEDIUM, "Medium"),
    (SEVERITY_HIGH, "High"),
    (SEVERITY_CRITICAL, "Critical"),
]

STATUS_OPEN = "open"
STATUS_ACKNOWLEDGED = "acknowledged"
STATUS_RESOLVED = "resolved"
STATUS_CHOICES = [
    (STATUS_OPEN, "Open"),
    (STATUS_ACKNOWLEDGED, "Acknowledged"),
    (STATUS_RESOLVED, "Resolved"),
]

ANOMALY_DEAL_AMOUNT_DROP = "deal_amount_drop"
ANOMALY_REP_ACTIVITY_DROP = "rep_activity_drop"
ANOMALY_LEAD_RESPONSE_SLOW = "lead_response_slow"
ANOMALY_UNUSUAL_PATTERN = "unusual_pattern"
ANOMALY_TYPE_CHOICES = [
    (ANOMALY_DEAL_AMOUNT_DROP, "Deal Amount Drop"),
    (ANOMALY_REP_ACTIVITY_DROP, "Rep Activity Drop"),
    (ANOMALY_LEAD_RESPONSE_SLOW, "Lead Response Slow"),
    (ANOMALY_UNUSUAL_PATTERN, "Unusual Pattern"),
]


class Anomaly(TenantModel):
    """A single detected CRM anomaly."""

    record_type = models.CharField(max_length=32, db_index=True)
    record_id = models.CharField(max_length=32, db_index=True)
    anomaly_type = models.CharField(
        max_length=32, choices=ANOMALY_TYPE_CHOICES, default=ANOMALY_UNUSUAL_PATTERN,
        db_index=True,
    )
    severity = models.CharField(
        max_length=16, choices=SEVERITY_CHOICES, default=SEVERITY_LOW, db_index=True
    )
    description = models.TextField(default="")
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="acknowledged_anomalies",
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_OPEN, db_index=True
    )
    detected_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "anomaly_detection_anomaly"
        verbose_name = "anomaly"
        verbose_name_plural = "anomalies"
        ordering = ["-detected_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="anom_status_idx"),
            models.Index(fields=["tenant", "-detected_at"], name="anom_detected_idx"),
            models.Index(
                fields=["tenant", "severity", "-detected_at"], name="anom_sev_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.anomaly_type} / {self.record_type}:{self.record_id} [{self.severity}]"


__all__ = [
    "ANOMALY_DEAL_AMOUNT_DROP",
    "ANOMALY_LEAD_RESPONSE_SLOW",
    "ANOMALY_REP_ACTIVITY_DROP",
    "ANOMALY_TYPE_CHOICES",
    "ANOMALY_UNUSUAL_PATTERN",
    "Anomaly",
    "SEVERITY_CHOICES",
    "SEVERITY_CRITICAL",
    "SEVERITY_HIGH",
    "SEVERITY_LOW",
    "SEVERITY_MEDIUM",
    "STATUS_ACKNOWLEDGED",
    "STATUS_CHOICES",
    "STATUS_OPEN",
    "STATUS_RESOLVED",
]
