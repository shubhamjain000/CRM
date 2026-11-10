"""factory_boy factories for the profiles app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant

from .models import ACCESS_EDITABLE, FieldPermission, Profile, ProfilePermission


class ProfileFactory(DjangoModelFactory):
    """Factory for :class:`Profile`."""

    class Meta:
        model = Profile

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Profile {n}")
    description = "Test profile"
    is_standard = False


class ProfilePermissionFactory(DjangoModelFactory):
    """Factory for :class:`ProfilePermission`."""

    class Meta:
        model = ProfilePermission

    tenant = factory.LazyFunction(_current_tenant)
    profile = factory.SubFactory(ProfileFactory)
    module = "lead"
    can_view = True
    can_create = True
    can_edit = True
    can_delete = False
    can_export = False
    can_share = False


class FieldPermissionFactory(DjangoModelFactory):
    """Factory for :class:`FieldPermission`."""

    class Meta:
        model = FieldPermission

    tenant = factory.LazyFunction(_current_tenant)
    profile = factory.SubFactory(ProfileFactory)
    module = "lead"
    field_name = factory.Sequence(lambda n: f"field_{n}")
    access = ACCESS_EDITABLE


__all__ = [
    "FieldPermissionFactory",
    "ProfileFactory",
    "ProfilePermissionFactory",
]
