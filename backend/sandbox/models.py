"""Database models for the sandbox app (Phase 17).

A single tenant-scoped :class:`Sandbox` row captures a configuration
branch. ``snapshot_data`` is a JSONField containing the captured
customisation snapshot (custom_modules / layouts / profiles /
territories / canvas / template_builder state — captured by
:func:`sandbox.services.create_snapshot`). ``expires_at`` enables
TTL-based cleanup of abandoned branches.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel


class Sandbox(TenantModel):
    """A configuration sandbox branch for this tenant.

    ``branch_name`` is unique per tenant. ``snapshot_data`` carries
    the captured state. ``is_active`` flips to ``False`` once the
    branch is pushed to production or abandoned.
    """

    branch_name = models.CharField(max_length=100, db_index=True)
    snapshot_data = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True, default="")
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "sandbox_sandbox"
        verbose_name = "sandbox"
        verbose_name_plural = "sandboxes"
        unique_together = (("tenant", "branch_name"),)
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="sandbox_active_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.branch_name} ({'active' if self.is_active else 'merged'})"

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and self.expires_at <= timezone.now()


__all__ = ["Sandbox"]
