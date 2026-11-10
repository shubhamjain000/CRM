"""Database models for the access_control app (Phase 20)."""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import UniqueConstraint

from api.models import TenantModel


class IPAllowlist(TenantModel):
    """A tenant-scoped CIDR allowlist entry."""

    cidr = models.CharField(max_length=64, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "access_control_ipallowlist"
        verbose_name = "ip allowlist entry"
        verbose_name_plural = "ip allowlist entries"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="ipal_active_idx"),
        ]

    def __str__(self) -> str:
        flag = "active" if self.is_active else "inactive"
        return f"{self.cidr} ({flag})"


class SessionPolicy(TenantModel):
    """One-per-tenant session timeout + concurrency cap."""

    timeout_minutes = models.PositiveIntegerField(default=60)
    max_concurrent = models.PositiveIntegerField(default=3)

    class Meta:
        db_table = "access_control_sessionpolicy"
        verbose_name = "session policy"
        verbose_name_plural = "session policies"
        ordering = ["-created_at"]
        constraints = [
            UniqueConstraint(fields=["tenant"], name="sp_one_per_tenant"),
        ]

    def __str__(self) -> str:
        return f"session-policy({self.tenant.slug})"


class TrustedDevice(TenantModel):
    """A user's trusted device within a tenant."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trusted_devices",
    )
    device_id = models.CharField(max_length=128, db_index=True)
    last_seen = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "access_control_trusteddevice"
        verbose_name = "trusted device"
        verbose_name_plural = "trusted devices"
        ordering = ["-last_seen"]
        unique_together = (("tenant", "user", "device_id"),)
        indexes = [
            models.Index(fields=["tenant", "user"], name="td_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.device_id} @ {self.tenant.slug}"


__all__ = ["IPAllowlist", "SessionPolicy", "TrustedDevice"]
