"""Model-layer tests for the workflows app."""

from __future__ import annotations

import pytest

from workflows.factories import (
    WorkflowActionFactory,
    WorkflowExecutionFactory,
    WorkflowRuleFactory,
)
from workflows.models import WorkflowRule


pytestmark = pytest.mark.django_db


def test_workflow_rule_str(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant, name="Welcome lead")
    text = str(rule)
    assert "Welcome lead" in text
    assert "record_create" in text


def test_workflow_rule_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant)
    assert rule.is_active is True
    assert rule.trigger_type == "record_create"
    assert rule.trigger_model == "lead"
    assert rule.trigger_conditions == {}
    assert rule.run_count == 0
    assert rule.error_count == 0
    assert rule.version == 1


def test_workflow_action_ordering(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = WorkflowRuleFactory(tenant=active_tenant)
    WorkflowActionFactory(tenant=active_tenant, rule=rule, order=2)
    WorkflowActionFactory(tenant=active_tenant, rule=rule, order=0)
    WorkflowActionFactory(tenant=active_tenant, rule=rule, order=1)
    orders = [a.order for a in rule.actions.order_by("order")]
    assert orders == [0, 1, 2]


def test_workflow_execution_str(active_tenant, user):  # type: ignore[no-untyped-def]
    exec_row = WorkflowExecutionFactory(
        tenant=active_tenant, target_module="deal", target_id="42", status="completed"
    )
    text = str(exec_row)
    assert "deal:42" in text
    assert "completed" in text


def test_workflow_rule_query_filters_by_trigger(active_tenant, user):  # type: ignore[no-untyped-def]
    WorkflowRuleFactory.create_batch(2, tenant=active_tenant, trigger_type="record_create")
    WorkflowRuleFactory(tenant=active_tenant, trigger_type="record_update")
    assert WorkflowRule.objects.filter(trigger_type="record_create").count() == 2
    assert WorkflowRule.objects.filter(trigger_type="record_update").count() == 1
