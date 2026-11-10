"""ViewSet / API tests for the assignment_rules app."""

from __future__ import annotations

import pytest

from assignment_rules.factories import (
    AssignmentHistoryFactory,
    AssignmentRuleFactory,
)
from assignment_rules.models import AssignmentRule


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def grant_assignment_rules_permissions(admin_role):  # type: ignore[no-untyped-def]
    """Grant ``assignment_rules.manage`` to the admin role."""
    if "assignment_rules.manage" not in (admin_role.permissions or []):
        admin_role.permissions = list(admin_role.permissions or []) + [
            "assignment_rules.manage"
        ]
        admin_role.save(update_fields=["permissions"])
    return admin_role


###############################################################################
# AssignmentRuleViewSet
###############################################################################


def test_list_assignment_rules(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    AssignmentRuleFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/assignment-rules/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_assignment_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST",
        "/api/v1/assignment-rules/",
        {
            "target_model": "lead",
            "criteria": {"lead_source": "web"},
            "strategy": "round_robin",
            "assign_to": [user.pk],
            "is_active": True,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["target_model"] == "lead"
    assert body["strategy"] == "round_robin"
    assert body["assign_to"] == [user.pk]


def test_update_assignment_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = AssignmentRuleFactory(tenant=active_tenant, is_active=True)
    response = request_factory(
        "PATCH",
        f"/api/v1/assignment-rules/{rule.pk}/",
        {"is_active": False},
        format="json",
    )
    assert response.status_code == 200, response.content
    rule.refresh_from_db()
    assert rule.is_active is False


def test_destroy_assignment_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = AssignmentRuleFactory(tenant=active_tenant)
    response = request_factory("DELETE", f"/api/v1/assignment-rules/{rule.pk}/")
    assert response.status_code == 204, response.content
    assert not AssignmentRule.objects.filter(pk=rule.pk).exists()


def test_evaluate_action_returns_resolved_user(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={"lead_source": "web"},
        strategy="round_robin",
        assign_to=[user.pk],
    )
    response = request_factory(
        "POST",
        "/api/v1/assignment-rules/evaluate/",
        {"target_model": "deal", "record": {"lead_source": "web"}},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["user_id"] == user.pk


def test_evaluate_action_returns_none_when_no_match(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={"lead_source": "web"},
    )
    response = request_factory(
        "POST",
        "/api/v1/assignment-rules/evaluate/",
        {"target_model": "deal", "record": {"lead_source": "phone"}},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["user_id"] is None
    assert body["rule_id"] is None


###############################################################################
# AssignmentHistoryViewSet
###############################################################################


def test_list_assignment_histories(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    AssignmentHistoryFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/assignment-histories/")
    assert response.status_code == 200, response.content
    body = response.json()
    results = body.get("results", body)
    assert len(results) == 3


def test_filter_assignment_histories_by_record(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    AssignmentHistoryFactory(tenant=active_tenant, record_module="deal", record_id="42")
    AssignmentHistoryFactory(tenant=active_tenant, record_module="lead", record_id="1")
    response = request_factory(
        "GET", "/api/v1/assignment-histories/?record_module=deal&record_id=42"
    )
    assert response.status_code == 200, response.content
    body = response.json()
    results = body.get("results", body)
    assert len(results) == 1
    assert results[0]["record_module"] == "deal"
    assert results[0]["record_id"] == "42"
