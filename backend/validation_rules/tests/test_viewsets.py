"""ViewSet / API tests for the validation_rules app."""

from __future__ import annotations

import pytest

from validation_rules.factories import ValidationRuleFactory
from validation_rules.models import ValidationRule


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def grant_validation_rules_permissions(admin_role):  # type: ignore[no-untyped-def]
    """Grant ``validation_rules.manage`` to the admin role."""
    if "validation_rules.manage" not in (admin_role.permissions or []):
        admin_role.permissions = list(admin_role.permissions or []) + ["validation_rules.manage"]
        admin_role.save(update_fields=["permissions"])
    return admin_role


###############################################################################
# CRUD
###############################################################################


def test_list_validation_rules(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/validation-rules/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_validation_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST",
        "/api/v1/validation-rules/",
        {
            "target_model": "deal",
            "field_name": "amount",
            "condition_type": "range",
            "condition_value": {"min": 100, "max": 10000},
            "error_message": "Amount must be in [100, 10000].",
            "error_severity": "error",
            "trigger_on": "both",
            "is_active": True,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["target_model"] == "deal"
    assert body["condition_type"] == "range"
    assert body["condition_value"] == {"min": 100, "max": 10000}


def test_update_validation_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(tenant=active_tenant, is_active=True)
    response = request_factory(
        "PATCH",
        f"/api/v1/validation-rules/{rule.pk}/",
        {"is_active": False},
        format="json",
    )
    assert response.status_code == 200, response.content
    rule.refresh_from_db()
    assert rule.is_active is False


def test_destroy_validation_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ValidationRuleFactory(tenant=active_tenant)
    response = request_factory("DELETE", f"/api/v1/validation-rules/{rule.pk}/")
    assert response.status_code == 204, response.content
    assert not ValidationRule.objects.filter(pk=rule.pk).exists()


###############################################################################
# test action
###############################################################################


def test_test_action_returns_violations(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type="required",
        error_message="Name is required.",
    )
    response = request_factory(
        "POST",
        "/api/v1/validation-rules/test/",
        {"target_model": "deal", "record": {"name": ""}, "trigger": "create"},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert len(body["violations"]) == 1
    assert body["violations"][0]["field_name"] == "name"


def test_test_action_returns_no_violations_when_clean(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="name",
        condition_type="required",
    )
    response = request_factory(
        "POST",
        "/api/v1/validation-rules/test/",
        {"target_model": "deal", "record": {"name": "Big Deal"}},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["violations"] == []


###############################################################################
# bulk_check action
###############################################################################


def test_bulk_check_action_returns_violations(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    from decimal import Decimal

    from deals.factories import DealFactory

    ValidationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        field_name="amount",
        condition_type="range",
        condition_value={"min": 1000},
        error_message="Amount must be >= 1000.",
    )
    DealFactory(tenant=active_tenant, amount=Decimal("100"))
    response = request_factory(
        "GET",
        "/api/v1/validation-rules/bulk-check/?target_model=deal",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["target_model"] == "deal"
    assert body["checked"] == 1
    assert len(body["violations"]) == 1
