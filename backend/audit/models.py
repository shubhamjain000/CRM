"""Database models for the audit app (Phase 20).

Single immutable tenant-scoped model: :class:`AuditLog`.

``changes`` carries a field-level diff such as ``{"field": [old, new]}``.
The model overrides :meth:`save` and :meth:`delete` to make rows append-
only — updates and deletes raise :class:`PermissionError`.
"""

from __future__ import annotations

from typing import Any

from django.db import models

from api.models import TenantModel


class AuditLog(TenantModel):
    """Append-only audit row with field-level change diff."""

    actor_id = models.CharField(max_length=64, db_index=True)
    action = models.CharField(max_length=128, db_index=True)
    target_type = models.CharField(max_length=128, db_index=True)
    target_id = models.CharField(max_length=64, db_index=True)
    changes = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "audit_log"
        verbose_name = "audit log"
        verbose_name_plural = "audit logs"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["tenant", "timestamp"], name="audit_ts_idx"),
            models.Index(
                fields=["tenant", "target_type", "target_id"], name="audit_target_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.action} on {self.target_type}:{self.target_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        """Allow inserts only — block any subsequent update."""
        if not self._state.adding:
            raise PermissionError("AuditLog rows are immutable.")
        super().save(*args, **kwargs)  # type: ignore[misc]

    def delete(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        """Block deletes — audit rows are append-only."""
        raise PermissionError("AuditLog rows are immutable.")


__all__ = ["AuditLog"]
