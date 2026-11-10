"""Model-layer tests for the profiles app."""

from __future__ import annotations

import pytest

from profiles.factories import (
    FieldPermissionFactory,
    ProfileFactory,
    ProfilePermissionFactory,
)
from profiles.models import (
    ACCESS_EDITABLE,
    FieldPermission,
    Profile,
    ProfilePermission,
)


pytestmark = pytest.mark.django_db


def test_profile_unique_per_tenant(active_tenant):  # type: ignore[no-untyped-def]
    ProfileFactory(tenant=active_tenant, name="Admin")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        ProfileFactory(tenant=active_tenant, name="Admin")


def test_profile_permission_unique_per_module(active_tenant):  # type: ignore[no-untyped-def]
    profile = ProfileFactory(tenant=active_tenant)
    ProfilePermissionFactory(tenant=active_tenant, profile=profile, module="lead")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        ProfilePermissionFactory(
            tenant=active_tenant, profile=profile, module="lead"
        )


def test_field_permission_default_access_editable(active_tenant):  # type: ignore[no-untyped-def]
    fp = FieldPermissionFactory(
        tenant=active_tenant, module="lead", field_name="ssn",
        access=ACCESS_EDITABLE,
    )
    assert fp.access == ACCESS_EDITABLE
