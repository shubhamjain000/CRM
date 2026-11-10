"""Database models for the security_monitoring app (Phase 20)."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

SEV_INFO = "info"
SEV_LOW = "low"
SEV_MEDIUM = "medium"
SEV_HIGH = "high"
SEV_CRITICAL = "critical"
SEVERITY_CHOICES = [
    (SEV_INFO, "info"),
    (SEV_LOW, "low"),
    (SEV_MEDIUM, "medium"),
    (SEV_HIGH, "high"),
    (SEV_CRITICAL, "critical"),
]

ALERT_OPEN = "open"
ALERT_ACKNOWLEDGED = "acknowledged"
ALERT_RESOLVED = "resolved"
ALERT_STATUS_CHOICES = [
    (ALERT_OPEN, "open"),
    (ALERT_ACKNOWLEDGED, "acknowledged"),
    (ALERT_RESOLVED, "resolved"),
]


class SecurityEvent(TenantModel):
    """Raw security event row (login brute-force, suspicious export, ...)."""

    event_type = models.CharField(max_length=128, db_index=True)
    severity = models.CharField(
        max_length=16, choices=SEVERITY_CHOICES, default=SEV_INFO, db_index=True
    )
    description = models.TextField(blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "security_event"
        verbose_name = "security event"
        verbose_name_plural = "security events"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "created_at"], name="se_created_idx"),
            models.Index(fields=["tenant", "severity"], name="se_sev_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.event_type} ({self.severity})"


class SecurityAlert(TenantModel):
    """Derived alert linked to a :class:`SecurityEvent`."""

    event = models.ForeignKey(
        SecurityEvent,
        on_delete=models.CASCADE,
        related_name="alerts",
    )
    status = models.CharField(
        max_length=16, choices=ALERT_STATUS_CHOICES, default=ALERT_OPEN, db_index=True
    )
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="acknowledged_alerts",
    )

    class Meta:
        db_table = "security_alert"
        verbose_name = "security alert"
        verbose_name_plural = "security alerts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="sa_status_idx"),
        ]

    def __str__(self) -> str:
        return f"alert({self.status}) -> {self.event_id}"


__all__ = [
    "SecurityEvent",
    "SecurityAlert",
    "SEV_INFO",
    "SEV_LOW",
    "SEV_MEDIUM",
    "SEV_HIGH",
    "SEV_CRITICAL",
    "SEVERITY_CHOICES",
    "ALERT_OPEN",
    "ALERT_ACKNOWLEDGED",
    "ALERT_RESOLVED",
    "ALERT_STATUS_CHOICES",
]
