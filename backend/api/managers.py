"""Tenant-aware managers and thread-local tenant context.

The thread-local ``_tenant_state`` is set by :class:`api.middleware.TenantMiddleware`
on every request and by the :func:`tenant_context` context manager (used by
Celery workers, management commands, and tests). Managers that subclass
:class:`TenantManager` will transparently scope their default queryset to the
active tenant whenever a context is set, while still exposing the unscoped
queryset via :meth:`TenantManager.unscoped`.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, Iterator

from django.db import models

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization


###############################################################################
# Thread-local tenant context
###############################################################################

_tenant_state = threading.local()


def get_current_tenant() -> "Organization | None":
    """Return the currently active tenant for this thread, or ``None``."""
    return getattr(_tenant_state, "tenant", None)


def set_current_tenant(tenant: "Organization | None") -> None:
    """Set (or clear) the active tenant on the current thread."""
    _tenant_state.tenant = tenant


@contextmanager
def tenant_context(tenant: "Organization | None") -> Iterator["Organization | None"]:
    """Bind ``tenant`` as the active tenant for the duration of the block.

    Restores the previously active tenant on exit so the manager is safe to
    nest. Pass ``None`` to run a block unscoped (e.g. for cross-tenant admin
    operations).
    """
    previous = get_current_tenant()
    set_current_tenant(tenant)
    try:
        yield tenant
    finally:
        set_current_tenant(previous)


###############################################################################
# Tenant-aware manager
###############################################################################


class TenantManager(models.Manager):
    """Manager that auto-filters by the active tenant from thread-local state.

    Subclasses (or the model using this manager) must define a ``tenant`` FK.
    ``get_queryset`` returns the unscoped queryset when no tenant is active so
    that system-level commands (migrations, django-admin) still work.
    """

    def get_queryset(self) -> models.QuerySet[Any]:
        queryset = super().get_queryset()
        tenant = get_current_tenant()
        if tenant is None:
            return queryset
        return queryset.filter(tenant_id=tenant.pk)

    def unscoped(self) -> models.QuerySet[Any]:
        """Bypass the tenant filter — use sparingly (admin, migrations)."""
        return super().get_queryset()

    def for_tenant(self, tenant_id: int | "Organization") -> models.QuerySet[Any]:
        """Explicit tenant filter that ignores thread-local state."""
        pk = tenant_id.pk if hasattr(tenant_id, "pk") else int(tenant_id)
        return super().get_queryset().filter(tenant_id=pk)
