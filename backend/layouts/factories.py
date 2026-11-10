"""factory_boy factories for the layouts app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant

from .models import Layout, LayoutSection, MODULE_LEAD


class LayoutFactory(DjangoModelFactory):
    """Factory for :class:`Layout`."""

    class Meta:
        model = Layout

    tenant = factory.LazyFunction(_current_tenant)
    module = MODULE_LEAD
    profile = None
    name = factory.Sequence(lambda n: f"Lead Layout {n}")
    config = factory.Dict({})
    is_default = False


class LayoutSectionFactory(DjangoModelFactory):
    """Factory for :class:`LayoutSection`."""

    class Meta:
        model = LayoutSection

    tenant = factory.LazyFunction(_current_tenant)
    layout = factory.SubFactory(LayoutFactory)
    name = factory.Sequence(lambda n: f"Section {n}")
    columns = 2
    order = 0
    is_collapsible = True
    fields = factory.List(["name", "email"])


__all__ = ["LayoutFactory", "LayoutSectionFactory"]
