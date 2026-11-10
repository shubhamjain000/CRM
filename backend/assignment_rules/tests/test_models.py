"""Model-layer tests for the assignment_rules app."""

from __future__ import annotations

import pytest

from assignment_rules.factories import (
    AssignmentHistoryFactory,
    AssignmentRuleFactory,
)
from assignment_rules.models import AssignmentHistory, AssignmentRule


pytestmark = pytest.mark.django_db


def test_assignment_rule_str(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = AssignmentRuleFactory(
        tenant=active_tenant, target_model="lead", strategy="round_robin"
    )
    text = str(rule)
    assert "lead" in text
    assert "round_robin" in text


def test_assignment_rule_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = AssignmentRuleFactory(tenant=active_tenant)
    assert rule.is_active is True
    assert rule.strategy == "round_robin"
    assert rule.criteria == {}
    assert rule.assign_to == []


def test_assignment_history_str(active_tenant, user):  # type: ignore[no-untyped-def]
    history = AssignmentHistoryFactory(
        tenant=active_tenant,
        record_module="deal",
        record_id="42",
        assigned_to=user,
    )
    text = str(history)
    assert "deal:42" in text
    assert str(user.pk) in text


def test_assignment_history_factory_persists(active_tenant, user):  # type: ignore[no-untyped-def]
    history = AssignmentHistoryFactory(tenant=active_tenant, assigned_to=user)
    assert history.pk is not None
    assert AssignmentHistory.objects.filter(pk=history.pk).exists()


def test_assignment_rule_query_filters_by_target(active_tenant, user):  # type: ignore[no-untyped-def]
    AssignmentRuleFactory.create_batch(2, tenant=active_tenant, target_model="deal")
    AssignmentRuleFactory(tenant=active_tenant, target_model="lead")
    assert AssignmentRule.objects.filter(target_model="deal").count() == 2
    assert AssignmentRule.objects.filter(target_model="lead").count() == 1
