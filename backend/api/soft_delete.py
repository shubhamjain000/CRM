"""Soft-delete infrastructure for CRM data models.

Models that inherit :class:`SoftDeleteTenantModel` get:

* a nullable ``deleted_at`` column (set by :meth:`soft_delete`),
* a default ``objects`` manager that excludes soft-deleted rows,
* an ``all_objects`` manager that includes them (used by restore),
* ``TenantManager``-style scoping via the thread-local tenant.

The pattern intentionally mirrors :class:`api.models.TenantModel` so the
CRM apps are consistent with the rest of the codebase.
"""

from __future__ import annotations

from typing import Any

from django.db import models
from django.utils import timezone

from .managers import TenantManager, get_current_tenant


class SoftDeleteTenantManager(TenantManager):
    """Default manager: tenant-scoped + excludes soft-deleted rows."""

    def get_queryset(self) -> models.QuerySet[Any]:
        queryset = super().get_queryset()
        return queryset.filter(deleted_at__isnull=True)

    def all_with_deleted(self) -> models.QuerySet[Any]:
        """Tenant-scoped queryset that *includes* soft-deleted rows."""
        return super().get_queryset()

    def deleted_only(self) -> models.QuerySet[Any]:
        """Tenant-scoped queryset of only soft-deleted rows."""
        return super().get_queryset().filter(deleted_at__isnull=False)


class AllObjectsManager(models.Manager):
    """Unscoped manager that includes soft-deleted rows.

    Used as ``all_objects`` on soft-delete models for admin / restore flows.
    Never auto-applies a tenant filter.
    """

    def get_queryset(self) -> models.QuerySet[Any]:
        return super().get_queryset()


class SoftDeleteTenantModel(models.Model):
    """Tenant-scoped, timestamped, soft-deletable abstract base.

    Concrete subclasses inherit ``objects = SoftDeleteTenantManager()`` and
    ``all_objects = AllObjectsManager()`` automatically.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="+",
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    objects = SoftDeleteTenantManager()
    all_objects = AllObjectsManager()

    class Meta:
        abstract = True

    # ------------------------------------------------------------------ soft delete

    def soft_delete(self, *, using: str | None = None) -> None:
        """Mark this row as deleted (set ``deleted_at``) without removing it."""
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at", "updated_at"], using=using)

    def restore(self, *, using: str | None = None) -> None:
        """Recover a soft-deleted row."""
        self.deleted_at = None
        self.save(update_fields=["deleted_at", "updated_at"], using=using)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


def assert_tenant_on(instance: Any) -> Any:
    """Return the active tenant or raise ``RuntimeError``.

    Convenience helper for CRM model ``save()`` hooks that need to auto-fill
    ``tenant`` when not explicitly provided (e.g. ``bulk_create``).
    """
    if getattr(instance, "tenant_id", None) is None:
        tenant = get_current_tenant()
        if tenant is None:
            raise RuntimeError(
                f"{instance.__class__.__name__} requires a tenant — none set on the thread-local."
            )
        instance.tenant = tenant
    return instance.tenant
