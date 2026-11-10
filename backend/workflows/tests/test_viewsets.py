"""ViewSet / API tests for the workflows app."""

from __future__ import annotations

import pytest

from workflows.factories import (
    WorkflowExecutionFactory,
    WorkflowRuleFactory,
)
from workflows.models import WorkflowRule


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def grant_workflows_permissions(admin_role):  # type: ignore[no-untyped-def]
    """Grant ``workflows.manage`` to the admin role."""
    if "workflows.manage" not in (admin_role.permissions or []):
        admin_role.permissions = list(admin_role.permissions or []) + [
            "workflows.manage"
        ]
        admin_role.save(update_fields=["permissions"])
    return admin_role


###############################################################################
# WorkflowRuleViewSet
###############################################################################


def test_list_workflow_rules(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    WorkflowRuleFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/workflow-rules/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_workflow_rule_with_nested_actions(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST",
        "/api/v1/workflow-rules/",
        {
            "name": "Welcome lead",
            "trigger_type": "record_create",
            "trigger_model": "lead",
            "trigger_conditions": {},
            "is_active": True,
            "actions": [
                {"action_type": "add_tag", "config": {"tag": "new"}, "order": 0},
                {"action_type": "send_email", "config": {"subject": "Hi"}, "order": 1},
            ],
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Welcome lead"
    assert len(body["actions"]) == 2
    rule = WorkflowRule.objects.get(pk=body["id"])
    assert rule.actions.count() == 2


def test_activate_and_deactivate_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant, is_active=True)
    response = request_factory("POST", f"/api/v1/workflow-rules/{rule.pk}/deactivate/")
    assert response.status_code == 200, response.content
    rule.refresh_from_db()
    assert rule.is_active is False
    response = request_factory("POST", f"/api/v1/workflow-rules/{rule.pk}/activate/")
    assert response.status_code == 200, response.content
    rule.refresh_from_db()
    assert rule.is_active is True


def test_duplicate_rule(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant, name="Original")
    response = request_factory("POST", f"/api/v1/workflow-rules/{rule.pk}/duplicate/")
    assert response.status_code == 201, response.content
    body = response.json()
    assert "copy" in body["name"]
    assert body["id"] != rule.pk
    assert WorkflowRule.objects.count() == 2


def test_templates_endpoint(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory("GET", "/api/v1/workflow-rules/templates/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert isinstance(body, list)
    assert len(body) >= 5


def test_export_and_import_json(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant, name="Exportable")
    export = request_factory("GET", f"/api/v1/workflow-rules/{rule.pk}/export-json/")
    assert export.status_code == 200, response.content
    payload = export.json()
    payload["name"] = "Imported rule"
    payload["is_active"] = False
    response = request_factory("POST", "/api/v1/workflow-rules/import-json/", payload, format="json")
    assert response.status_code == 201, response.content
    assert WorkflowRule.objects.filter(name="Imported rule").exists()


def test_metrics_endpoint(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant)
    WorkflowExecutionFactory(tenant=active_tenant, rule=rule, status="completed")
    response = request_factory("GET", f"/api/v1/workflow-rules/{rule.pk}/metrics/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["total_runs"] == 1
    assert body["success_rate"] == 1.0


###############################################################################
# WorkflowExecutionViewSet
###############################################################################


def test_list_executions_filter_by_status(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    WorkflowExecutionFactory.create_batch(2, tenant=active_tenant, status="completed")
    WorkflowExecutionFactory(tenant=active_tenant, status="failed")
    response = request_factory("GET", "/api/v1/workflow-executions/?status=failed")
    assert response.status_code == 200, response.content
    body = response.json()
    results = body.get("results", body)
    assert len(results) == 1
    assert results[0]["status"] == "failed"
