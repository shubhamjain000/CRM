"""factory_boy factories for the custom_fields app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant
from custom_fields.models import CustomField, CustomFieldValue


class CustomFieldFactory(DjangoModelFactory):
    class Meta:
        model = CustomField

    tenant = factory.LazyFunction(_current_tenant)
    module = "lead"
    label = factory.Sequence(lambda n: f"Field {n}")
    api_name = factory.Sequence(lambda n: f"field_{n}")
    field_type = "text"
    field_options = factory.LazyFunction(dict)
    validation_rules = factory.LazyFunction(dict)
    default_value = ""
    is_required = False
    is_unique = False
    is_searchable = False


class CustomFieldValueFactory(DjangoModelFactory):
    class Meta:
        model = CustomFieldValue

    tenant = factory.LazyFunction(_current_tenant)
    field = factory.SubFactory(CustomFieldFactory)
    module = "lead"
    record_id = factory.Sequence(lambda n: str(n))
    value = "sample"
