"""Shared factory_boy factories for tenant + user.

The CRM app factories import these so they can lazily attach the active
tenant (set via ``tenant_context`` in tests) or create one when none exists.
"""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.managers import get_current_tenant
from api.models import Organization, User


def _current_tenant() -> Organization:
    """Return the thread-local tenant or create a fresh one."""
    tenant = get_current_tenant()
    if tenant is not None:
        return tenant
    existing = Organization.objects.first()
    if existing is not None:
        return existing
    return OrganizationFactory()


def _current_user() -> User:
    existing = User.objects.first()
    if existing is not None:
        return existing
    return UserFactory()


class OrganizationFactory(DjangoModelFactory):
    class Meta:
        model = Organization

    subdomain = factory.Sequence(lambda n: f"org-{n}")
    custom_domain = None
    name = factory.Sequence(lambda n: f"Organization {n}")
    slug = factory.Sequence(lambda n: f"org-{n}")
    is_active = True
    plan = "free"


class UserFactory(DjangoModelFactory):
    class Meta:
        model = User
        django_get_or_create = ("email",)

    email = factory.Sequence(lambda n: f"user{n}@example.com")
    name = factory.Faker("name")
    is_active_account = True
