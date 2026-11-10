"""Database models for the compliance app (Phase 20)."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

STATUS_PENDING = "pending"
STATUS_MET = "met"
STATUS_NOT_APPLICABLE = "not_applicable"
STATUS_CHOICES = [
    (STATUS_PENDING, "pending"),
    (STATUS_MET, "met"),
    (STATUS_NOT_APPLICABLE, "not_applicable"),
]


class ComplianceFramework(models.Model):
    """A global compliance framework (SOC 2, ISO 27001, GDPR, ...).

    Not tenant-scoped — the framework catalog is shared across tenants;
    each tenant links to it via :class:`ComplianceChecklist`.
    """

    name = models.CharField(max_length=128, unique=True, db_index=True)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "compliance_framework"
        verbose_name = "compliance framework"
        verbose_name_plural = "compliance frameworks"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class ComplianceChecklist(TenantModel):
    """Per-tenant checklist item under a :class:`ComplianceFramework`."""

    framework = models.ForeignKey(
        ComplianceFramework,
        on_delete=models.CASCADE,
        related_name="checklist_items",
    )
    item = models.CharField(max_length=512)
    status = models.CharField(
        max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    evidence = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "compliance_checklist"
        verbose_name = "compliance checklist item"
        verbose_name_plural = "compliance checklist items"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="cc_status_idx"),
            models.Index(fields=["tenant", "framework"], name="cc_fw_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.framework}: {self.item} ({self.status})"


class DataProcessingConsent(TenantModel):
    """Per-user data processing consent record."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="consents",
    )
    consent_type = models.CharField(max_length=64, db_index=True)
    granted_at = models.DateTimeField(auto_now_add=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "compliance_consent"
        verbose_name = "data processing consent"
        verbose_name_plural = "data processing consents"
        ordering = ["-granted_at"]
        unique_together = (("tenant", "user", "consent_type"),)
        indexes = [
            models.Index(fields=["tenant", "consent_type"], name="dpc_type_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.consent_type} @ {self.tenant.slug}"


__all__ = [
    "ComplianceFramework",
    "ComplianceChecklist",
    "DataProcessingConsent",
    "STATUS_PENDING",
    "STATUS_MET",
    "STATUS_NOT_APPLICABLE",
    "STATUS_CHOICES",
]
