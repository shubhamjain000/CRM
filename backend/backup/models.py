"""Database models for the backup app (Phase 20)."""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

TYPE_FULL = "full"
TYPE_INCREMENTAL = "incremental"
TYPE_WAL = "wal"
TYPE_CHOICES = [
    (TYPE_FULL, "full"),
    (TYPE_INCREMENTAL, "incremental"),
    (TYPE_WAL, "wal"),
]

STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CHOICES = [
    (STATUS_PENDING, "pending"),
    (STATUS_RUNNING, "running"),
    (STATUS_COMPLETED, "completed"),
    (STATUS_FAILED, "failed"),
]


class BackupRecord(TenantModel):
    """Metadata row for a tenant backup snapshot."""

    type = models.CharField(max_length=16, choices=TYPE_CHOICES, db_index=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    size_bytes = models.BigIntegerField(default=0)
    s3_key = models.CharField(max_length=512, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "backup_record"
        verbose_name = "backup record"
        verbose_name_plural = "backup records"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="br_status_idx"),
            models.Index(fields=["tenant", "type"], name="br_type_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.type} backup ({self.status})"


__all__ = [
    "BackupRecord",
    "TYPE_FULL",
    "TYPE_INCREMENTAL",
    "TYPE_WAL",
    "TYPE_CHOICES",
    "STATUS_PENDING",
    "STATUS_RUNNING",
    "STATUS_COMPLETED",
    "STATUS_FAILED",
    "STATUS_CHOICES",
]
