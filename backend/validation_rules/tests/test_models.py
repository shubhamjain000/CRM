"""Model-layer tests for the validation_rules app."""

from __future__ import annotations

import pytest

from validation_rules.factories import ValidationRuleFactory
from validation_rules.models import ValidationRule


pytestmark = pytest.mark.django_db


def test_validation_rule_str(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type="range",
        error_severity="error",
    )
    text = str(rule)
    assert "deal.amount" in text
    assert "range" in text
    assert "error" in text


def test_validation_rule_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(tenant=active_tenant)
    assert rule.is_active is True
    assert rule.error_severity == "error"
    assert rule.trigger_on == "both"
    assert rule.condition_type == "required"
    assert rule.condition_value == {}


def test_validation_rule_query_filters_by_target(active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory.create_batch(2, tenant=active_tenant, target_model="deal")
    ValidationRuleFactory(tenant=active_tenant, target_model="lead")
    assert ValidationRule.objects.filter(target_model="deal").count() == 2
    assert ValidationRule.objects.filter(target_model="lead").count() == 1


def test_validation_rule_factory_persists(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(tenant=active_tenant)
    assert rule.pk is not None
    assert ValidationRule.objects.filter(pk=rule.pk).exists()
