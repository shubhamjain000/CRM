"""Service-layer tests for the profiles app."""

from __future__ import annotations

from profiles.factories import (
    FieldPermissionFactory,
    ProfileFactory,
    ProfilePermissionFactory,
)
from profiles.models import ACCESS_HIDDEN, Profile
from profiles.services import build_permission_matrix, clone_profile


pytestmark = pytest.mark.django_db


def test_build_permission_matrix_aggregates_modules_and_fields(active_tenant):  # type: ignore[no-untyped-def]
    profile = ProfileFactory(tenant=active_tenant)
    ProfilePermissionFactory(
        tenant=active_tenant, profile=profile, module="lead",
        can_view=True, can_create=True,
    )
    FieldPermissionFactory(
        tenant=active_tenant, profile=profile, module="lead",
        field_name="ssn", access=ACCESS_HIDDEN,
    )
    matrix = build_permission_matrix(profile)
    lead = matrix["modules"]["lead"]
    assert lead["can_view"] is True
    assert lead["fields"]["ssn"] == "hidden"


def test_clone_profile_deep_copies_permissions(active_tenant):  # type: ignore[no-untyped-def]
    profile = ProfileFactory(tenant=active_tenant, name="Original")
    ProfilePermissionFactory(
        tenant=active_tenant, profile=profile, module="lead", can_view=True
    )
    FieldPermissionFactory(
        tenant=active_tenant, profile=profile, module="lead", field_name="email"
    )
    clone = clone_profile(profile, new_name="Cloned")
    assert clone.pk != profile.pk
    assert clone.name == "Cloned"
    assert clone.is_standard is False
    assert clone.permissions.count() == 1
    assert clone.field_permissions.count() == 1
    # Source unchanged.
    assert profile.permissions.count() == 1
