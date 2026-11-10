"""Model-layer tests for the escalation_rules app."""

from __future__ import annotations

import pytest

from escalation_rules.factories import (
    EscalationLogFactory,
    EscalationRuleFactory,
)
from escalation_rules.models import EscalationLog, EscalationRule


pytestmark = pytest.mark.django_db


def test_escalation_rule_str(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = EscalationRuleFactory(
        tenant=active_tenant, target_model="deal", time_limit_hours=48
    )
    text = str(rule)
    assert "deal" in text
    assert "48h" in text


def test_escalation_rule_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = EscalationRuleFactory(tenant=active_tenant)
    assert rule.is_active is True
    assert rule.action == "notify"
    assert rule.time_limit_hours == 24
    assert rule.criteria == {}
    assert rule.escalate_to == {}


def test_escalation_log_str(active_tenant, user):  # type: ignore[no-untyped-def]
    log_row = EscalationLogFactory(
        tenant=active_tenant,
        record_module="deal",
        record_id="42",
        escalated_to=user,
        action_taken="notify",
    )
    text = str(log_row)
    assert "deal:42" in text
    assert str(user.pk) in text
    assert "notify" in text


def test_escalation_log_factory_persists(active_tenant, user):  # type: ignore[no-untyped-def]
    log_row = EscalationLogFactory(tenant=active_tenant, escalated_to=user)
    assert log_row.pk is not None
    assert EscalationLog.objects.filter(pk=log_row.pk).exists()


def test_escalation_rule_query_filters_by_target(active_tenant, user):  # type: ignore[no-untyped-def]
    EscalationRuleFactory.create_batch(2, tenant=active_tenant, target_model="deal")
    EscalationRuleFactory(tenant=active_tenant, target_model="lead")
    assert EscalationRule.objects.filter(target_model="deal").count() == 2
    assert EscalationRule.objects.filter(target_model="lead").count() == 1
