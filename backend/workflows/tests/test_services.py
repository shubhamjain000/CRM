"""Service-layer tests for the workflows app.

Covers :class:`workflows.services.WorkflowService`:
* ``evaluate_conditions`` — operators + boolean composition + empty.
* ``execute_workflow`` — happy path + action failure isolation.
* ``get_templates`` / ``get_metrics``.
"""

from __future__ import annotations

import pytest

from workflows.factories import (
    WorkflowActionFactory,
    WorkflowExecutionFactory,
    WorkflowRuleFactory,
)
from workflows.models import WorkflowExecution
from workflows.services import WorkflowService


pytestmark = pytest.mark.django_db


###############################################################################
# evaluate_conditions
###############################################################################


def test_evaluate_conditions_empty_matches_everything(active_tenant, user):  # type: ignore[no-untyped-def]
    service = WorkflowService()
    assert service.evaluate_conditions({}, {"lead_source": "web"}) is True
    assert service.evaluate_conditions({}, {}) is True


def test_evaluate_conditions_operators(active_tenant, user):  # type: ignore[no-untyped-def]
    service = WorkflowService()
    data = {"stage": "qualified", "amount": 5000, "tags": ["hot", "vip"]}
    assert service.evaluate_conditions({"stage": {"$eq": "qualified"}}, data) is True
    assert service.evaluate_conditions({"stage": {"$ne": "won"}}, data) is True
    assert service.evaluate_conditions({"amount": {"$gt": 1000}}, data) is True
    assert service.evaluate_conditions({"amount": {"$lt": 1000}}, data) is False
    assert service.evaluate_conditions({"stage": {"$in": ["qualified", "won"]}}, data) is True
    assert service.evaluate_conditions({"tags": {"$contains": "hot"}}, data) is True
    assert service.evaluate_conditions({"stage": {"$exists": True}}, data) is True
    assert service.evaluate_conditions({"missing": {"$exists": False}}, data) is True


def test_evaluate_conditions_boolean_composition(active_tenant, user):  # type: ignore[no-untyped-def]
    service = WorkflowService()
    data = {"stage": "qualified", "amount": 5000}
    cond = {
        "$and": [
            {"stage": {"$eq": "qualified"}},
            {"$or": [{"amount": {"$gt": 10000}}, {"amount": {"$lt": 10000}}]},
            {"$not": {"stage": {"$eq": "won"}}},
        ]
    }
    assert service.evaluate_conditions(cond, data) is True


###############################################################################
# execute_workflow
###############################################################################


def test_execute_workflow_runs_actions_in_order(active_tenant, user):  # type: ignore[no-untyped-def]
    from accounts.factories import AccountFactory

    rule = WorkflowRuleFactory(tenant=active_tenant, trigger_model="account")
    WorkflowActionFactory(
        tenant=active_tenant,
        rule=rule,
        order=0,
        action_type="add_tag",
        config={"tag": "workflow-tag"},
    )
    WorkflowActionFactory(
        tenant=active_tenant,
        rule=rule,
        order=1,
        action_type="create_task",
        config={"title": "Follow up", "assignee": user.pk},
    )
    account = AccountFactory(tenant=active_tenant, owner=user)
    execution = WorkflowService().execute_workflow(
        rule_id=rule.pk, target_module="account", target_id=str(account.pk)
    )
    assert execution.status == "completed"
    assert len(execution.actions_executed) == 2
    account.refresh_from_db()
    assert "workflow-tag" in (account.tags or [])
    rule.refresh_from_db()
    assert rule.run_count == 1
    assert rule.last_run_at is not None


def test_execute_workflow_action_failure_does_not_abort(active_tenant, user):  # type: ignore[no-untyped-def]
    from accounts.factories import AccountFactory

    rule = WorkflowRuleFactory(tenant=active_tenant, trigger_model="account")
    WorkflowActionFactory(
        tenant=active_tenant,
        rule=rule,
        order=0,
        action_type="update_field",
        config={"field": "nonexistent_field", "value": "x"},
    )
    WorkflowActionFactory(
        tenant=active_tenant,
        rule=rule,
        order=1,
        action_type="add_tag",
        config={"tag": "still-runs"},
    )
    account = AccountFactory(tenant=active_tenant, owner=user)
    execution = WorkflowService().execute_workflow(
        rule_id=rule.pk, target_module="account", target_id=str(account.pk)
    )
    assert execution.status == "failed"
    statuses = [e["status"] for e in execution.actions_executed]
    assert "failed" in statuses
    assert "completed" in statuses
    account.refresh_from_db()
    assert "still-runs" in (account.tags or [])


###############################################################################
# templates + metrics
###############################################################################


def test_get_templates_returns_prebuilt_workflows(active_tenant, user):  # type: ignore[no-untyped-def]
    templates = WorkflowService().get_templates()
    names = {t["name"] for t in templates}
    assert "Welcome new lead" in names
    assert "Win deal celebration" in names
    assert "Re-engage dormant lead" in names
    assert all(t["actions"] for t in templates)


def test_get_metrics_for_rule_with_executions(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant)
    WorkflowExecutionFactory(tenant=active_tenant, rule=rule, status="completed")
    WorkflowExecutionFactory(tenant=active_tenant, rule=rule, status="completed")
    WorkflowExecutionFactory(tenant=active_tenant, rule=rule, status="failed")
    metrics = WorkflowService().get_metrics(rule.pk)
    assert metrics["total_runs"] == 3
    assert metrics["success_rate"] == round(2 / 3, 4)
    assert metrics["error_count"] == 1
    assert metrics["last_run"] is not None


def test_get_metrics_empty_rule(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant)
    metrics = WorkflowService().get_metrics(rule.pk)
    assert metrics["total_runs"] == 0
    assert metrics["success_rate"] == 0.0
    assert metrics["last_run"] is None
