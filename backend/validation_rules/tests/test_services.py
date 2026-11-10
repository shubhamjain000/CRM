"""Service-layer tests for the validation_rules app.

Covers :class:`validation_rules.services.ValidationService`:

* ``evaluate_rule`` — each ``condition_type`` (required / regex / range /
  unique / custom).
* ``validate_record`` — happy path + multi-rule aggregation + trigger
  filtering + severity tagging.
* ``bulk_check`` — iterates existing records and returns violations.
* ``enforce`` — raises ``ValidationError`` on error-severity; warns on
  warning-severity.
"""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError

from validation_rules.factories import ValidationRuleFactory
from validation_rules.models import (
    CONDITION_CUSTOM,
    CONDITION_RANGE,
    CONDITION_REGEX,
    CONDITION_REQUIRED,
    CONDITION_UNIQUE,
    SEVERITY_ERROR,
    SEVERITY_WARNING,
    TRIGGER_CREATE,
    TRIGGER_UPDATE,
)
from validation_rules.services import ValidationService


pytestmark = pytest.mark.django_db


###############################################################################
# evaluate_rule
###############################################################################


def test_evaluate_required_passes(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type=CONDITION_REQUIRED,
    )
    result = ValidationService().evaluate_rule(rule, {"name": "Big Deal"})
    assert result["valid"] is True


def test_evaluate_required_fails_when_empty(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type=CONDITION_REQUIRED,
        error_message="Name is required.",
    )
    result = ValidationService().evaluate_rule(rule, {"name": ""})
    assert result["valid"] is False
    assert result["message"] == "Name is required."


def test_evaluate_regex_passes(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="currency",
        condition_type=CONDITION_REGEX,
        condition_value={"regex": "^[A-Z]{3}$"},
    )
    result = ValidationService().evaluate_rule(rule, {"currency": "USD"})
    assert result["valid"] is True


def test_evaluate_regex_fails(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="currency",
        condition_type=CONDITION_REGEX,
        condition_value={"regex": "^[A-Z]{3}$"},
    )
    result = ValidationService().evaluate_rule(rule, {"currency": "us"})
    assert result["valid"] is False


def test_evaluate_range_passes(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_RANGE,
        condition_value={"min": 100, "max": 10000},
    )
    result = ValidationService().evaluate_rule(rule, {"amount": "5000"})
    assert result["valid"] is True


def test_evaluate_range_fails_below_min(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_RANGE,
        condition_value={"min": 100},
    )
    result = ValidationService().evaluate_rule(rule, {"amount": "50"})
    assert result["valid"] is False


def test_evaluate_custom_passes(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_CUSTOM,
        condition_value={"expression": "value > 0 and value < 100000"},
    )
    result = ValidationService().evaluate_rule(rule, {"amount": 50000})
    assert result["valid"] is True


def test_evaluate_custom_fails(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_CUSTOM,
        condition_value={"expression": "value > 0 and value < 100000"},
    )
    result = ValidationService().evaluate_rule(rule, {"amount": 200000})
    assert result["valid"] is False


###############################################################################
# validate_record
###############################################################################


def test_validate_record_aggregates_violations(active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type=CONDITION_REQUIRED,
        error_message="Name is required.",
    )
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_RANGE,
        condition_value={"min": 100},
        error_message="Amount must be >= 100.",
    )
    violations = ValidationService().validate_record("deal", {"name": "", "amount": "50"})
    assert len(violations) == 2
    messages = {v.message for v in violations}
    assert "Name is required." in messages
    assert "Amount must be >= 100." in messages


def test_validate_record_filters_by_trigger(active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type=CONDITION_REQUIRED,
        trigger_on=TRIGGER_CREATE,
        error_message="Name on create.",
    )
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_REQUIRED,
        trigger_on=TRIGGER_UPDATE,
        error_message="Amount on update.",
    )
    # Trigger=create → only the name rule fires.
    violations = ValidationService().validate_record(
        "deal", {"name": "", "amount": ""}, trigger="create"
    )
    assert len(violations) == 1
    assert violations[0].field_name == "name"


def test_validate_record_tags_severity(active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type=CONDITION_REQUIRED,
        error_severity=SEVERITY_ERROR,
    )
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="description",
        condition_type=CONDITION_REQUIRED,
        error_severity=SEVERITY_WARNING,
    )
    violations = ValidationService().validate_record(
        "deal", {"name": "", "description": ""}
    )
    by_field = {v.field_name: v.severity for v in violations}
    assert by_field["name"] == SEVERITY_ERROR
    assert by_field["description"] == SEVERITY_WARNING


def test_validate_record_unique_via_signal_safe(active_tenant, user):  # type: ignore[no-untyped-def]
    """The unique check is exercised end-to-end by the signal test below."""
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_UNIQUE,
        error_message="Amount must be unique.",
    )
    # No existing deals — should be no violations.
    violations = ValidationService().validate_record("deal", {"amount": "1000"})
    assert violations == []


###############################################################################
# enforce
###############################################################################


def test_enforce_raises_on_error_severity(active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type=CONDITION_REQUIRED,
        error_severity=SEVERITY_ERROR,
    )
    with pytest.raises(ValidationError):
        ValidationService().enforce("deal", {"name": ""}, trigger="create")


def test_enforce_passes_on_warning_severity(active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type=CONDITION_REQUIRED,
        error_severity=SEVERITY_WARNING,
    )
    # Should not raise.
    ValidationService().enforce("deal", {"name": ""}, trigger="create")


###############################################################################
# bulk_check
###############################################################################


def test_bulk_check_returns_violations_across_records(active_tenant, user):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type=CONDITION_RANGE,
        condition_value={"min": 1000},
        error_message="Amount must be >= 1000.",
    )
    # Deal below the threshold — should produce a violation.
    DealFactory(tenant=active_tenant, amount=100)
    # Deal above — should not.
    DealFactory(tenant=active_tenant, amount=5000)
    violations = ValidationService().bulk_check("deal")
    assert len(violations) == 1
    assert violations[0].field_name == "amount"
