"""Service-layer tests for the escalation_rules app.

Covers :class:`escalation_rules.services.EscalationService`:

* ``evaluate_criteria`` — happy path + no-match + empty criteria.
* ``check_escalations`` — escalates past-due records; leaves fresh ones
  alone; dedups within the time-limit window.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from escalation_rules.factories import EscalationRuleFactory
from escalation_rules.models import (
    ACTION_BOTH,
    ACTION_NOTIFY,
    ACTION_REASSIGN,
    EscalationLog,
)
from escalation_rules.services import EscalationService


pytestmark = pytest.mark.django_db


###############################################################################
# evaluate_criteria
###############################################################################


def test_evaluate_criteria_matches(active_tenant, user):  # type: ignore[no-untyped-def]
    service = EscalationService()
    assert service.evaluate_criteria({"lead_source": "web"}, {"lead_source": "web"}) is True


def test_evaluate_criteria_no_match(active_tenant, user):  # type: ignore[no-untyped-def]
    service = EscalationService()
    assert service.evaluate_criteria({"lead_source": "phone"}, {"lead_source": "web"}) is False


def test_evaluate_criteria_empty_matches_everything(active_tenant, user):  # type: ignore[no-untyped-def]
    service = EscalationService()
    assert service.evaluate_criteria({"lead_source": "phone"}, {}) is True
    assert service.evaluate_criteria({}, {}) is True


###############################################################################
# check_escalations
###############################################################################


def test_check_escalations_escalates_past_due(active_tenant, user):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    EscalationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        time_limit_hours=1,
        action=ACTION_NOTIFY,
        escalate_to={"type": "user", "value": user.pk},
    )
    # Backdate a deal past the 1h SLA.
    deal = DealFactory(tenant=active_tenant, owner=user)
    deal.created_at = timezone.now() - timedelta(hours=3)
    deal.save(update_fields=["created_at"])
    summary = EscalationService().check_escalations()
    assert summary["checked"] >= 1
    assert EscalationLog.objects.filter(
        record_module="deal", record_id=str(deal.pk)
    ).exists()


def test_check_escalations_leaves_fresh_records_alone(active_tenant, user):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    EscalationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        time_limit_hours=24,
        action=ACTION_NOTIFY,
        escalate_to={"type": "user", "value": user.pk},
    )
    # Fresh deal — created just now.
    DealFactory(tenant=active_tenant, owner=user)
    EscalationService().check_escalations()
    assert EscalationLog.objects.count() == 0


def test_check_escalations_filters_by_criteria(active_tenant, user):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    EscalationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={"lead_source": "web"},
        time_limit_hours=1,
        action=ACTION_NOTIFY,
        escalate_to={"type": "user", "value": user.pk},
    )
    # Past-due deal with a DIFFERENT lead_source — should NOT be escalated.
    deal = DealFactory(tenant=active_tenant, owner=user, lead_source="phone")
    deal.created_at = timezone.now() - timedelta(hours=3)
    deal.save(update_fields=["created_at"])
    EscalationService().check_escalations()
    assert EscalationLog.objects.filter(record_id=str(deal.pk)).exists() is False


def test_check_escalations_dedups_within_window(active_tenant, user):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    EscalationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        time_limit_hours=1,
        action=ACTION_NOTIFY,
        escalate_to={"type": "user", "value": user.pk},
    )
    deal = DealFactory(tenant=active_tenant, owner=user)
    deal.created_at = timezone.now() - timedelta(hours=3)
    deal.save(update_fields=["created_at"])
    # First pass: creates a log.
    EscalationService().check_escalations()
    first_count = EscalationLog.objects.filter(record_id=str(deal.pk)).count()
    assert first_count == 1
    # Second pass: should NOT create another log within the time-limit window.
    EscalationService().check_escalations()
    second_count = EscalationLog.objects.filter(record_id=str(deal.pk)).count()
    assert second_count == 1


def test_check_escalations_reassigns_owner_when_action_reassign(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from api.factories import UserFactory
    from api.models import TenantMembership
    from deals.factories import DealFactory

    other = UserFactory(email="escalate_target@example.com")
    TenantMembership.objects.create(
        user=other, tenant=active_tenant, role=admin_role, is_active=True
    )
    EscalationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        time_limit_hours=1,
        action=ACTION_REASSIGN,
        escalate_to={"type": "user", "value": other.pk},
    )
    deal = DealFactory(tenant=active_tenant, owner=user)
    deal.created_at = timezone.now() - timedelta(hours=3)
    deal.save(update_fields=["created_at"])
    EscalationService().check_escalations()
    deal.refresh_from_db()
    assert deal.owner_id == other.pk


def test_check_escalations_action_both_reassigns_and_notifies(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from api.factories import UserFactory
    from api.models import TenantMembership
    from deals.factories import DealFactory

    other = UserFactory(email="both_target@example.com")
    TenantMembership.objects.create(
        user=other, tenant=active_tenant, role=admin_role, is_active=True
    )
    EscalationRuleFactory(
        tenant=active_tenant,
        target_model="deal",
        criteria={},
        time_limit_hours=1,
        action=ACTION_BOTH,
        escalate_to={"type": "user", "value": other.pk},
    )
    deal = DealFactory(tenant=active_tenant, owner=user)
    deal.created_at = timezone.now() - timedelta(hours=3)
    deal.save(update_fields=["created_at"])
    EscalationService().check_escalations()
    deal.refresh_from_db()
    assert deal.owner_id == other.pk
    log_row = EscalationLog.objects.filter(record_id=str(deal.pk)).first()
    assert log_row is not None
    assert log_row.action_taken == ACTION_BOTH
