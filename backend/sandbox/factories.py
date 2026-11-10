"""factory_boy factories for the sandbox app."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant

from .models import Sandbox


class SandboxFactory(DjangoModelFactory):
    """Factory for :class:`Sandbox`."""

    class Meta:
        model = Sandbox

    tenant = factory.LazyFunction(_current_tenant)
    branch_name = factory.Sequence(lambda n: f"branch-{n}")
    snapshot_data = factory.Dict({"custom_modules": []})
    description = "Test branch"
    expires_at = factory.LazyFunction(lambda: timezone.now() + timedelta(days=7))
    is_active = True


__all__ = ["SandboxFactory"]
