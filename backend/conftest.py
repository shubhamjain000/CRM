"""Pytest fixtures shared across the CRM app test-suites.

These fixtures live at the backend root so they're available to all CRM apps.
"""

from __future__ import annotations

import pytest

from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from api.models import Role, TenantMembership

# Re-export ``tenant_context`` so tests can do ``from conftest import tenant_context``.
__all__ = [
    "tenant",
    "admin_role",
    "user",
    "active_tenant",
    "api_client",
    "request_factory",
    "tenant_context",
]

# Touch the import so static analyzers don't flag it as unused.
_ = tenant_context


@pytest.fixture
def tenant(db):  # type: ignore[no-untyped-def]
    """A fresh organization."""
    return OrganizationFactory(name="Test Org", subdomain="testorg", slug="testorg")


@pytest.fixture
def admin_role(tenant):  # type: ignore[no-untyped-def]
    """An admin role carrying ``org.admin`` (passes all HasPermission checks)."""
    role, _ = Role.objects.get_or_create(
        tenant=tenant,
        name="Admin",
        defaults={"permissions": ["org.admin"], "is_system": True},
    )
    return role


@pytest.fixture
def user(tenant, admin_role):  # type: ignore[no-untyped-def]
    """A user with an active admin membership in ``tenant``."""
    user = UserFactory(email="crm-user@example.com", name="CRM User")
    TenantMembership.objects.create(user=user, tenant=tenant, role=admin_role, is_active=True)
    return user


@pytest.fixture
def active_tenant(tenant):  # type: ignore[no-untyped-def]
    """Bind ``tenant`` as the active thread-local for the duration of the test."""
    set_current_tenant(tenant)
    yield tenant
    set_current_tenant(None)


@pytest.fixture
def api_client(user):  # type: ignore[no-untyped-def]
    """An authenticated DRF ``APIClient`` for ``user``."""
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def request_factory(api_client, tenant):  # type: ignore[no-untyped-def]
    """Return a callable: ``request("GET", "/api/v1/accounts/")``.

    Automatically sets the ``X-Organization`` header so the TenantMiddleware
    resolves the right tenant.
    """

    def _request(method: str, path: str, **kwargs):  # type: ignore[no-untyped-def]
        kwargs.setdefault("HTTP_X_ORGANIZATION", str(tenant.slug))
        return getattr(api_client, method.lower())(path, **kwargs)

    return _request
