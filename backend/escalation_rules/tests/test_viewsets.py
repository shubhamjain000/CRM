"""ViewSet / API tests for the escalation_rules app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from escalation_rules.factories import (
    EscalationLogFactory,
    EscalationRuleFactory,
)
from escalation_rules.models import EscalationRule


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def grant_escalation_rules_permissions(admin_role):  # type: ignore[no-untyped-def]
    """Grant ``escalation_rules.manage`` to the admin role."""
    if "escalation_rules.manage" not in (admin_role.permissions or []):
        admin_role.permissions = list(admin_role.permissions or []) + [
            "escalation_rules.manage"
        ]
        admin_role.save(update_fields=["permissions"])
    return admin_role


###############################################################################
# EscalationRuleViewSet
###############################################################################


def test_list_escalation_rules(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    EscalationRuleFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/escalation-rules/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_escalation_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST",
        "/api/v1/escalation-rules/",
        {
            "target_model": "deal",
            "criteria": {"lead_source": "web"},
            "time_limit_hours": 24,
            "escalate_to": {"type": "user", "value": user.pk},
            "action": "notify",
            "is_active": True,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["target_model"] == "deal"
    assert body["time_limit_hours"] == 24
    assert body["escalate_to"] == {"type": "user", "value": user.pk}


def test_update_escalation_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = EscalationRuleFactory(tenant=active_tenant, is_active=True)
    response = request_factory(
        "PATCH",
        f"/api/v1/escalation-rules/{rule.pk}/",
        {"is_active": False},
        format="json",
    )
    assert response.status_code == 200, response.content
    rule.refresh_from_db()
    assert rule.is_active is False


def test_destroy_escalation_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = EscalationRuleFactory(tenant=active_tenant)
    response = request_factory("DELETE", f"/api/v1/escalation-rules/{rule.pk}/")
    assert response.status_code == 204, response.content
    assert not EscalationRule.objects.filter(pk=rule.pk).exists()


def test_dry_run_returns_past_due_records(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    rule = EscalationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        time_limit_hours=1,
    )
    deal = DealFactory(tenant=active_tenant, owner=user)
    deal.created_at = timezone.now() - timedelta(hours=3)
    deal.save(update_fields=["created_at"])
    response = request_factory("GET", f"/api/v1/escalation-rules/{rule.pk}/dry-run/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] >= 1
    ids = [r["record_id"] for r in body["results"]]
    assert deal.pk in ids


###############################################################################
# EscalationLogViewSet
###############################################################################


def test_list_escalation_logs(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    EscalationLogFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/escalation-logs/")
    assert response.status_code == 200, response.content
    body = response.json()
    results = body.get("results", body)
    assert len(results) == 3


def test_filter_escalation_logs_by_record(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    EscalationLogFactory(tenant=active_tenant, record_module="deal", record_id="42")
    EscalationLogFactory(tenant=active_tenant, record_module="lead", record_id="1")
    response = request_factory(
        "GET", "/api/v1/escalation-logs/?record_module=deal&record_id=42"
    )
    assert response.status_code == 200, response.content
    body = response.json()
    results = body.get("results", body)
    assert len(results) == 1
    assert results[0]["record_module"] == "deal"
    assert results[0]["record_id"] == "42"
