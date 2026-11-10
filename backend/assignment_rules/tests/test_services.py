"""Service-layer tests for the assignment_rules app.

Covers :class:`assignment_rules.services.AssignmentService`:

* ``evaluate_rules`` — happy path + no-match.
* ``execute_strategy`` — round_robin / lead_balance / territory / custom.
* ``assign`` — updates the record's owner + logs an AssignmentHistory row.
"""

from __future__ import annotations

import pytest

from assignment_rules.factories import AssignmentRuleFactory
from assignment_rules.models import (
    AssignmentHistory,
    STRATEGY_CUSTOM,
    STRATEGY_LEAD_BALANCE,
    STRATEGY_ROUND_ROBIN,
    STRATEGY_TERRITORY,
)
from assignment_rules.services import AssignmentService


pytestmark = pytest.mark.django_db


###############################################################################
# Helpers
###############################################################################


def _make_user(tenant, admin_role, email):  # type: ignore[no-untyped-def]
    from api.factories import UserFactory
    from api.models import TenantMembership

    user = UserFactory(email=email)
    TenantMembership.objects.create(
        user=user, tenant=tenant, role=admin_role, is_active=True
    )
    return user


###############################################################################
# evaluate_rules
###############################################################################


def test_evaluate_rules_returns_first_match(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    u1 = _make_user(active_tenant, admin_role, "u1@example.com")
    rule = AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={"lead_source": "web"},
        strategy=STRATEGY_ROUND_ROBIN,
        assign_to=[u1.pk],
    )
    service = AssignmentService()
    matched_rule, resolved_user = service.evaluate_rules(
        "deal", {"lead_source": "web", "amount": 5000}
    )
    assert matched_rule.pk == rule.pk
    assert resolved_user.pk == u1.pk


def test_evaluate_rules_returns_none_when_no_match(active_tenant, user):  # type: ignore[no-untyped-def]
    AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={"lead_source": "web"},
    )
    service = AssignmentService()
    rule, resolved = service.evaluate_rules("deal", {"lead_source": "phone"})
    assert rule is None
    assert resolved is None


def test_evaluate_rules_falls_back_when_strategy_returns_none(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    fallback = _make_user(active_tenant, admin_role, "fallback@example.com")
    AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        strategy=STRATEGY_ROUND_ROBIN,
        assign_to=[],  # empty → strategy returns None
        fallback_user=fallback,
    )
    service = AssignmentService()
    rule, resolved = service.evaluate_rules("deal", {"amount": 1000})
    assert rule is not None
    assert resolved.pk == fallback.pk


###############################################################################
# execute_strategy
###############################################################################


def test_strategy_round_robin_picks_first_then_next(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    u1 = _make_user(active_tenant, admin_role, "rr1@example.com")
    u2 = _make_user(active_tenant, admin_role, "rr2@example.com")
    rule = AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        strategy=STRATEGY_ROUND_ROBIN,
        assign_to=[u1.pk, u2.pk],
    )
    service = AssignmentService()
    # First call → u1 (no prior history).
    assert service.execute_strategy(rule, {}).pk == u1.pk
    # Simulate the first assignment by logging history.
    AssignmentHistory.objects.create(
        tenant=active_tenant,
        rule=rule,
        record_module="deal",
        record_id="1",
        assigned_to=u1,
    )
    # Second call → u2.
    assert service.execute_strategy(rule, {}).pk == u2.pk
    AssignmentHistory.objects.create(
        tenant=active_tenant,
        rule=rule,
        record_module="deal",
        record_id="2",
        assigned_to=u2,
    )
    # Third call → wraps around to u1.
    assert service.execute_strategy(rule, {}).pk == u1.pk


def test_strategy_lead_balance_picks_fewest(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    u1 = _make_user(active_tenant, admin_role, "lb1@example.com")
    u2 = _make_user(active_tenant, admin_role, "lb2@example.com")
    # Give u1 two deals, u2 zero.
    DealFactory(tenant=active_tenant, owner=u1)
    DealFactory(tenant=active_tenant, owner=u1)
    rule = AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        strategy=STRATEGY_LEAD_BALANCE,
        assign_to=[u1.pk, u2.pk],
    )
    service = AssignmentService()
    resolved = service.execute_strategy(rule, {})
    assert resolved.pk == u2.pk  # u2 has fewer.


def test_strategy_territory_lookup(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    u_us = _make_user(active_tenant, admin_role, "us@example.com")
    u_eu = _make_user(active_tenant, admin_role, "eu@example.com")
    rule = AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        strategy=STRATEGY_TERRITORY,
        territory_field="industry",
        assign_to={"user_map": {"Banking": u_us.pk, "Healthcare": u_eu.pk}},
    )
    service = AssignmentService()
    resolved = service.execute_strategy(rule, {"industry": "Banking"})
    assert resolved.pk == u_us.pk
    resolved = service.execute_strategy(rule, {"industry": "Healthcare"})
    assert resolved.pk == u_eu.pk


def test_strategy_territory_returns_none_when_no_match(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    u_us = _make_user(active_tenant, admin_role, "us2@example.com")
    rule = AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        strategy=STRATEGY_TERRITORY,
        territory_field="industry",
        assign_to={"user_map": {"Banking": u_us.pk}},
    )
    service = AssignmentService()
    resolved = service.execute_strategy(rule, {"industry": "Unknown"})
    assert resolved is None


def test_strategy_custom_expression(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    u_high = _make_user(active_tenant, admin_role, "high@example.com")
    u_low = _make_user(active_tenant, admin_role, "low@example.com")
    rule = AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        strategy=STRATEGY_CUSTOM,
        assign_to={
            "expression": "u_high if record.get('amount', 0) > 50000 else u_low",
        },
    )
    # Patch the expression namespace so the test users are in scope.
    service = AssignmentService()
    # The expression references ``u_high`` / ``u_low`` as bare names —
    # the production code only injects ``record`` + safe builtins. We
    # override the expression here to use ``record`` keys directly so
    # the test exercises the eval path without monkey-patching.
    rule.assign_to = {
        "expression": "100 if record.get('amount', 0) > 50000 else 200",
    }
    # u_high pk is whatever it was assigned; we just check the eval works.
    resolved_high = service.execute_strategy(rule, {"amount": 60000})
    # The expression returns 100 → user with pk=100 may not exist; that's
    # fine, the service returns None and we fall through to fallback.
    # Patch the rule to return u_high.pk directly.
    rule.assign_to = {
        "expression": f"{u_high.pk} if record.get('amount', 0) > 50000 else {u_low.pk}",
    }
    resolved_high = service.execute_strategy(rule, {"amount": 60000})
    assert resolved_high.pk == u_high.pk
    resolved_low = service.execute_strategy(rule, {"amount": 1000})
    assert resolved_low.pk == u_low.pk


###############################################################################
# assign
###############################################################################


def test_assign_updates_owner_and_logs_history(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    u1 = _make_user(active_tenant, admin_role, "as1@example.com")
    rule = AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        strategy=STRATEGY_ROUND_ROBIN,
        assign_to=[u1.pk],
    )
    deal = DealFactory(tenant=active_tenant, owner=user)
    service = AssignmentService()
    history = service.assign(
        record_module="deal",
        record_id=deal.pk,
        record_data={"amount": str(deal.amount), "owner_id": user.pk},
    )
    assert history is not None
    assert history.assigned_to_id == u1.pk
    assert history.rule_id == rule.pk
    deal.refresh_from_db()
    assert deal.owner_id == u1.pk


def test_assign_returns_none_when_no_rule_matches(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    AssignmentRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={"lead_source": "web"},
    )
    deal = DealFactory(tenant=active_tenant, owner=user, lead_source="phone")
    service = AssignmentService()
    history = service.assign(
        record_module="deal",
        record_id=deal.pk,
        record_data={"lead_source": "phone"},
    )
    assert history is None
    deal.refresh_from_db()
    assert deal.owner_id == user.pk  # unchanged
