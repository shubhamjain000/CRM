"""Database models for the data_security app (Phase 20)."""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

CLASS_PUBLIC = "public"
CLASS_INTERNAL = "internal"
CLASS_CONFIDENTIAL = "confidential"
CLASS_RESTRICTED = "restricted"
CLASSIFICATION_CHOICES = [
    (CLASS_PUBLIC, "public"),
    (CLASS_INTERNAL, "internal"),
    (CLASS_CONFIDENTIAL, "confidential"),
    (CLASS_RESTRICTED, "restricted"),
]

ACTION_ARCHIVE = "archive"
ACTION_DELETE = "delete"
ACTION_CHOICES = [
    (ACTION_ARCHIVE, "archive"),
    (ACTION_DELETE, "delete"),
]


class DataClassification(TenantModel):
    """Per-field data classification tag."""

    model = models.CharField(max_length=128, db_index=True)
    field = models.CharField(max_length=128, db_index=True)
    classification = models.CharField(
        max_length=32,
        choices=CLASSIFICATION_CHOICES,
        default=CLASS_INTERNAL,
        db_index=True,
    )

    class Meta:
        db_table = "data_security_classification"
        verbose_name = "data classification"
        verbose_name_plural = "data classifications"
        ordering = ["-created_at"]
        unique_together = (("tenant", "model", "field"),)
        indexes = [
            models.Index(fields=["tenant", "classification"], name="dc_class_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.model}.{self.field} = {self.classification}"


class RetentionPolicy(TenantModel):
    """Per-model retention window + action."""

    model = models.CharField(max_length=128, db_index=True)
    retention_days = models.PositiveIntegerField(default=365)
    action = models.CharField(
        max_length=16, choices=ACTION_CHOICES, default=ACTION_ARCHIVE, db_index=True
    )

    class Meta:
        db_table = "data_security_retentionpolicy"
        verbose_name = "retention policy"
        verbose_name_plural = "retention policies"
        ordering = ["-created_at"]
        unique_together = (("tenant", "model"),)
        indexes = [
            models.Index(fields=["tenant", "action"], name="rp_action_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.model} -> {self.action}@{self.retention_days}d"


__all__ = [
    "DataClassification",
    "RetentionPolicy",
    "CLASS_PUBLIC",
    "CLASS_INTERNAL",
    "CLASS_CONFIDENTIAL",
    "CLASS_RESTRICTED",
    "CLASSIFICATION_CHOICES",
    "ACTION_ARCHIVE",
    "ACTION_DELETE",
    "ACTION_CHOICES",
]
