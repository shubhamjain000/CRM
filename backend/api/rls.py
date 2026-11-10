"""PostgreSQL Row-Level Security helpers.

This module produces the SQL that enables RLS on every tenant-scoped table.
RLS is a defense-in-depth mechanism: even if application code forgets to call
``TenantManager.for_tenant()``, PostgreSQL will refuse to return rows whose
``tenant_id`` does not match the current session's ``app.tenant_id`` setting.

The Django app sets ``SET LOCAL app.tenant_id = <pk>`` at the start of each
request via :class:`api.middleware.TenantMiddleware` (configured to call
:func:`set_rls_session_var`). When no tenant is bound, the policy uses
``COALESCE(current_setting('app.tenant_id', true), '0')`` which yields ``'0'``
and matches no row.

Usage::

    from api.rls import enable_rls
    enable_rls('api_team')

The management command ``setup_rls`` runs :func:`enable_rls` for every model
that inherits :class:`api.models.TenantModel`.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.db import connection

if TYPE_CHECKING:  # pragma: no cover
    from django.db.models import Model

log = logging.getLogger(__name__)


RLS_POLICY_SQL_TEMPLATE = """
-- Drop existing policy (idempotent) for {table}
DROP POLICY IF EXISTS tenant_isolation ON {table};

-- Force the policy to apply even to table owners.
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;

-- Allow superusers / role 'bypassrls' to skip (managed at PG level).
CREATE POLICY tenant_isolation ON {table}
    USING (
        tenant_id::text = COALESCE(current_setting('app.tenant_id', true), '0')
    )
    WITH CHECK (
        tenant_id::text = COALESCE(current_setting('app.tenant_id', true), '0')
    );
"""


SET_RLS_SESSION_SQL = "SET LOCAL app.tenant_id = %s"
RESET_RLS_SESSION_SQL = "RESET app.tenant_id"


def enable_rls(table: str) -> None:
    """Enable RLS with a tenant-isolation policy on ``table``.

    ``table`` must be the physical table name (e.g. ``api_team``). Idempotent.
    """
    sql = RLS_POLICY_SQL_TEMPLATE.format(table=table)
    with connection.cursor() as cursor:
        cursor.execute(sql)
    log.info("RLS enabled on %s", table)


def disable_rls(table: str) -> None:
    """Disable RLS on ``table`` (used by tests / migration rollbacks)."""
    with connection.cursor() as cursor:
        cursor.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
        cursor.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        cursor.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")


def set_rls_session_var(tenant_id: int | None) -> None:
    """Set the ``app.tenant_id`` session variable for the current transaction.

    Pass ``None`` to reset. The middleware calls this with the resolved tenant
    on every request so that RLS-enforced queries return only the right rows.
    """
    with connection.cursor() as cursor:
        if tenant_id is None:
            cursor.execute(RESET_RLS_SESSION_SQL)
        else:
            cursor.execute(SET_RLS_SESSION_SQL, [str(int(tenant_id))])


def tenant_scoped_tables() -> list[str]:
    """Return the physical table names of all TenantModel subclasses."""
    from django.apps import apps

    from .models import TenantModel

    tables: list[str] = []
    for model in apps.get_models():
        if not issubclass(model, TenantModel):
            continue
        if model._meta.abstract or model._meta.proxy:
            continue
        tables.append(model._meta.db_table)
    return sorted(set(tables))


def setup_all_rls() -> list[str]:
    """Enable RLS on every tenant-scoped table. Returns the table list."""
    tables = tenant_scoped_tables()
    for table in tables:
        try:
            enable_rls(table)
        except Exception:  # pragma: no cover — DB-level errors are noisy in logs
            log.exception("Failed to enable RLS on %s", table)
    return tables
