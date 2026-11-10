"""Service-layer tests for the territories app."""

from __future__ import annotations

from leads.factories import LeadFactory
from territories.factories import TerritoryFactory, TerritoryMemberFactory
from territories.services import evaluate_rules, realign_territory


pytestmark = pytest.mark.django_db


def test_evaluate_rules_filters_by_module_and_filters(active_tenant, user):  # type: ignore[no-untyped-def]
    LeadFactory(tenant=active_tenant, owner=user, lead_status="new", first_name="A")
    LeadFactory(tenant=active_tenant, owner=user, lead_status="qualified", first_name="B")
    qs = evaluate_rules(
        {"module": "lead", "filters": {"lead_status": "new"}}, active_tenant
    )
    assert qs.count() == 1
    lead = qs.first()
    assert lead is not None
    assert lead.lead_status == "new"


def test_realign_round_robin_distributes_records(active_tenant, user):  # type: ignore[no-untyped-def]
    other_user_email = "other-territory@example.com"
    from api.models import User  # noqa: PLC0415

    other = User.objects.create(email=other_user_email, name="Other")
    # Two leads initially owned by `user`; realign should redistribute them
    # round-robin across [user, other].
    LeadFactory(tenant=active_tenant, first_name="L1", owner=user)
    LeadFactory(tenant=active_tenant, first_name="L2", owner=user)
    territory = TerritoryFactory(
        tenant=active_tenant,
        rules={
            "module": "lead",
            "filters": {"lead_status": "new"},
            "strategy": "round_robin",
        },
        manager=user,
    )
    TerritoryMemberFactory(tenant=active_tenant, territory=territory, user=user)
    TerritoryMemberFactory(tenant=active_tenant, territory=territory, user=other)

    result = realign_territory(territory)
    assert result["matched"] == 2
    assert result["reassigned"] >= 1
    assert result["members"] == 2

