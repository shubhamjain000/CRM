"""factory_boy factories for the custom_modules app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant

from .models import (
    FIELD_NUMBER,
    FIELD_TEXT,
    CustomModule,
    CustomModuleField,
    CustomModuleRecord,
)


class CustomModuleFactory(DjangoModelFactory):
    """Factory for :class:`CustomModule`."""

    class Meta:
        model = CustomModule

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Properties {n}")
    plural_name = factory.Sequence(lambda n: f"Properties {n}s")
    slug = factory.Sequence(lambda n: f"properties_{n}")
    icon = "building"
    color = "#0ea5e9"
    record_name_field = "name"
    is_active = True
    is_system = False


class CustomModuleFieldFactory(DjangoModelFactory):
    """Factory for :class:`CustomModuleField`."""

    class Meta:
        model = CustomModuleField

    tenant = factory.LazyFunction(_current_tenant)
    module = factory.SubFactory(CustomModuleFactory)
    label = factory.Sequence(lambda n: f"Field {n}")
    api_name = factory.Sequence(lambda n: f"field_{n}")
    field_type = FIELD_TEXT
    field_options = factory.Dict({})
    default_value = None
    is_required = False
    is_unique = False
    is_searchable = False
    display_order = 0
    section = "General"


class CustomModuleRecordFactory(DjangoModelFactory):
    """Factory for :class:`CustomModuleRecord`."""

    class Meta:
        model = CustomModuleRecord

    tenant = factory.LazyFunction(_current_tenant)
    module = factory.SubFactory(CustomModuleFactory)
    data = factory.Dict({"name": "Sample Record", "amount": 1000})


__all__ = [
    "CustomModuleFactory",
    "CustomModuleFieldFactory",
    "CustomModuleRecordFactory",
]
