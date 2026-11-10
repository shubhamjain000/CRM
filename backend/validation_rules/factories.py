"""factory_boy factories for the validation_rules app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant
from validation_rules.models import (
    CONDITION_REQUIRED,
    SEVERITY_ERROR,
    TRIGGER_BOTH,
    ValidationRule,
)


class ValidationRuleFactory(DjangoModelFactory):
    """Factory for :class:`validation_rules.models.ValidationRule`.

    Defaults to a ``required`` rule on ``deal.name`` with
    ``error_severity=error`` and ``trigger_on=both``. Override
    ``condition_type`` / ``condition_value`` / ``field_name`` /
    ``target_model`` in the test to exercise the other evaluators.
    """

    class Meta:
        model = ValidationRule

    tenant = factory.LazyFunction(_current_tenant)
    target_model = "deal"
    field_name = "name"
    condition_type = CONDITION_REQUIRED
    condition_value = factory.LazyFunction(lambda: {})
    error_message = factory.Faker("sentence")
    error_severity = SEVERITY_ERROR
    trigger_on = TRIGGER_BOTH
    is_active = True


__all__ = ["ValidationRuleFactory"]
