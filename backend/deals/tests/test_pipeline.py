"""Pipeline engine tests (Phase 8).

Covers :class:`deals.services.PipelineService`:

* ``transition_deal`` — valid transition, missing-edge rejection, role
  gating, condition enforcement, locked-stage rejection.
* ``get_available_transitions`` — visible targets given the transition
  graph + the actor's role + the deal's state.
* ``check_stage_limits`` — stuck / alert / healthy branches.
* ``get_pipeline_metrics`` — per-stage counts + weighted values + the
  overall win-rate.
* ``get_deal_velocity`` — avg time-in-stage aggregation.
* ``get_stage_conversion_rates`` — forward-vs-lost per stage.

Tests touch only the service layer (no HTTP), mirroring the style used
by the rest of the backend's test-suite.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from api.managers import set_current_tenant, tenant_context
from deals.factories import (
    DealFactory,
    DealStageHistoryFactory,
    LostStageFactory,
    PipelineFactory,
    StageFactory,
    StageTransitionFactory,
    WonStageFactory,
)
from deals.models import Deal, DealStageHistory, StageTransition
from deals.services import PipelineService

pytestmark = pytest.mark.django_db


###############################################################################
# Fixtures
###############################################################################


@pytest.fixture
def sales_pipeline(active_tenant):  # type: ignore[no-untyped-def]
    """A 5-stage Sales Pipeline: Lead → Qualified → Proposal → Negotiation → Won + Lost."""
    pipeline = PipelineFactory(tenant=active_tenant, name="Sales Pipeline")
    lead = StageFactory(
        pipeline=pipeline, name="Lead", order=0, probability=10.0, forecast_category="pipeline"
    )
    qualified = StageFactory(
        pipeline=pipeline, name="Qualified", order=1, probability=30.0, forecast_category="pipeline"
    )
    proposal = StageFactory(
        pipeline=pipeline, name="Proposal", order=2, probability=50.0, forecast_category="best_case"
    )
    negotiation = StageFactory(
        pipeline=pipeline, name="Negotiation", order=3, probability=70.0, forecast_category="commit"
    )
    won = WonStageFactory(pipeline=pipeline, name="Closed Won", order=4)
    lost = LostStageFactory(pipeline=pipeline, name="Closed Lost", order=5)
    # Linear forward edges + the two terminal exits.
    pairs = [
        (lead, qualified),
        (qualified, proposal),
        (proposal, negotiation),
        (negotiation, won),
        (lead, lost),
        (qualified, lost),
        (proposal, lost),
        (negotiation, lost),
    ]
    for from_stage, to_stage in pairs:
        StageTransitionFactory(
            tenant=active_tenant,
            pipeline=pipeline,
            from_stage=from_stage,
            to_stage=to_stage,
        )
    return {
        "pipeline": pipeline,
        "lead": lead,
        "qualified": qualified,
        "proposal": proposal,
        "negotiation": negotiation,
        "won": won,
        "lost": lost,
    }


@pytest.fixture
def deal_in_lead(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """A fresh deal sitting in the Lead stage."""
    return DealFactory(
        tenant=active_tenant,
        pipeline=sales_pipeline["pipeline"],
        stage=sales_pipeline["lead"],
        amount=Decimal("5000.00"),
        probability=10.0,
        owner=user,
    )


###############################################################################
# transition_deal — valid path
###############################################################################


def test_transition_deal_valid_updates_stage_and_forecast(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    service = PipelineService()
    result = service.transition_deal(deal_in_lead, sales_pipeline["qualified"], user)
    deal_in_lead.refresh_from_db()
    assert deal_in_lead.stage_id == sales_pipeline["qualified"].pk
    assert deal_in_lead.forecast_category == "pipeline"
    assert result.history.from_stage_id == sales_pipeline["lead"].pk
    assert result.history.to_stage_id == sales_pipeline["qualified"].pk
    assert result.history.changed_by_id == user.pk
    assert result.history.duration_in_previous_stage >= 0


def test_transition_deal_writes_history_row(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    service = PipelineService()
    service.transition_deal(deal_in_lead, sales_pipeline["qualified"], user)
    history = DealStageHistory.objects.filter(deal=deal_in_lead)
    assert history.count() == 1
    row = history.first()
    assert row.from_stage_id == sales_pipeline["lead"].pk
    assert row.to_stage_id == sales_pipeline["qualified"].pk


def test_transition_deal_records_duration_from_prior_history(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """Second transition's ``duration_in_previous_stage`` is measured from the
    first transition's ``changed_at``, not from ``deal.created_at``."""
    service = PipelineService()
    first = service.transition_deal(deal_in_lead, sales_pipeline["qualified"], user)
    # Backdate the first history entry by an hour so the duration is observable.
    hour_ago = timezone.now() - timedelta(hours=1)
    DealStageHistory.objects.filter(pk=first.history.pk).update(changed_at=hour_ago)
    second = service.transition_deal(deal_in_lead, sales_pipeline["proposal"], user)
    assert second.duration_in_previous_stage >= 3500  # ~1 hour, allow slack


def test_transition_deal_to_won_sets_probability_to_100(sales_pipeline, user):  # type: ignore[no-untyped-def]
    deal = DealFactory(
        pipeline=sales_pipeline["pipeline"],
        stage=sales_pipeline["negotiation"],
        probability=70.0,
    )
    PipelineService().transition_deal(deal, sales_pipeline["won"], user)
    deal.refresh_from_db()
    assert deal.probability == 100.0
    assert deal.forecast_category == "closed"
    assert deal.is_won is True


def test_transition_deal_to_lost_sets_probability_to_0(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    PipelineService().transition_deal(deal_in_lead, sales_pipeline["lost"], user)
    deal_in_lead.refresh_from_db()
    assert deal_in_lead.probability == 0.0
    assert deal_in_lead.forecast_category == "omitted"
    assert deal_in_lead.is_lost is True


###############################################################################
# transition_deal — invalid paths
###############################################################################


def test_transition_deal_rejects_missing_edge(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """Trying to skip two stages (Lead → Proposal, no direct edge) is rejected."""
    with pytest.raises(ValidationError):
        PipelineService().transition_deal(deal_in_lead, sales_pipeline["proposal"], user)


def test_transition_deal_rejects_cross_pipeline_stage(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    other_pipeline = PipelineFactory()
    other_stage = StageFactory(pipeline=other_pipeline)
    with pytest.raises(ValidationError):
        PipelineService().transition_deal(deal_in_lead, other_stage, user)


def test_transition_deal_rejects_same_stage(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    with pytest.raises(ValidationError):
        PipelineService().transition_deal(deal_in_lead, sales_pipeline["lead"], user)


def test_transition_deal_rejects_when_source_stage_locked(sales_pipeline, user):  # type: ignore[no-untyped-def]
    deal = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["won"])
    sales_pipeline["won"].is_locked = True
    sales_pipeline["won"].save(update_fields=["is_locked", "updated_at"])
    with pytest.raises(ValidationError):
        PipelineService().transition_deal(deal, sales_pipeline["negotiation"], user)


def test_transition_deal_enforces_role_allowlist(sales_pipeline, deal_in_lead, active_tenant, user):  # type: ignore[no-untyped-def]
    """A transition with ``allowed_roles=["closer"]`` rejects a non-closer user."""
    # Lock the Lead → Qualified edge to the "closer" role.
    StageTransition.objects.filter(
        pipeline=sales_pipeline["pipeline"],
        from_stage=sales_pipeline["lead"],
        to_stage=sales_pipeline["qualified"],
    ).update(allowed_roles=["closer"])
    # The default ``user`` fixture has the Admin role (not "closer").
    with pytest.raises(ValidationError):
        PipelineService().transition_deal(deal_in_lead, sales_pipeline["qualified"], user)


def test_transition_deal_allows_when_role_matches(sales_pipeline, deal_in_lead, active_tenant, user):  # type: ignore[no-untyped-def]
    """If the user's role name is in ``allowed_roles``, the transition succeeds."""
    StageTransition.objects.filter(
        pipeline=sales_pipeline["pipeline"],
        from_stage=sales_pipeline["lead"],
        to_stage=sales_pipeline["qualified"],
    ).update(allowed_roles=["admin"])
    # The default ``user`` fixture has the Admin role.
    result = PipelineService().transition_deal(deal_in_lead, sales_pipeline["qualified"], user)
    assert result.history.to_stage_id == sales_pipeline["qualified"].pk


def test_transition_deal_enforces_min_amount_condition(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A ``min_amount`` condition blocks deals below the threshold."""
    StageTransition.objects.filter(
        pipeline=sales_pipeline["pipeline"],
        from_stage=sales_pipeline["lead"],
        to_stage=sales_pipeline["qualified"],
    ).update(conditions={"min_amount": 10000})
    # Deal is at 5000 — should be rejected.
    with pytest.raises(ValidationError):
        PipelineService().transition_deal(deal_in_lead, sales_pipeline["qualified"], user)
    # Bump the amount and retry — should succeed.
    deal_in_lead.amount = Decimal("15000.00")
    deal_in_lead.save(update_fields=["amount", "updated_at"])
    result = PipelineService().transition_deal(deal_in_lead, sales_pipeline["qualified"], user)
    assert result.history.to_stage_id == sales_pipeline["qualified"].pk


def test_transition_deal_enforces_require_account_condition(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    StageTransition.objects.filter(
        pipeline=sales_pipeline["pipeline"],
        from_stage=sales_pipeline["lead"],
        to_stage=sales_pipeline["qualified"],
    ).update(conditions={"require_account": True})
    # Strip the account off the deal.
    deal_in_lead.account = None
    deal_in_lead.save(update_fields=["account", "updated_at"])
    with pytest.raises(ValidationError):
        PipelineService().transition_deal(deal_in_lead, sales_pipeline["qualified"], user)


###############################################################################
# get_available_transitions
###############################################################################


def test_get_available_transitions_returns_forward_stages(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    stages = PipelineService().get_available_transitions(deal_in_lead, user)
    stage_ids = {s.pk for s in stages}
    # Lead has two outgoing edges: → Qualified and → Lost.
    assert sales_pipeline["qualified"].pk in stage_ids
    assert sales_pipeline["lost"].pk in stage_ids
    # No other stage should be reachable.
    assert sales_pipeline["proposal"].pk not in stage_ids
    assert sales_pipeline["negotiation"].pk not in stage_ids
    assert sales_pipeline["won"].pk not in stage_ids


def test_get_available_transitions_empty_when_stage_locked(sales_pipeline, user):  # type: ignore[no-untyped-def]
    deal = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["won"])
    sales_pipeline["won"].is_locked = True
    sales_pipeline["won"].save(update_fields=["is_locked", "updated_at"])
    assert PipelineService().get_available_transitions(deal, user) == []


def test_get_available_transitions_hides_role_blocked(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    StageTransition.objects.filter(
        pipeline=sales_pipeline["pipeline"],
        from_stage=sales_pipeline["lead"],
    ).update(allowed_roles=["closer"])
    stages = PipelineService().get_available_transitions(deal_in_lead, user)
    # Both Lead edges are gated to "closer" — the admin user should see none.
    assert stages == []


def test_get_available_transitions_hides_condition_blocked(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    StageTransition.objects.filter(
        pipeline=sales_pipeline["pipeline"],
        from_stage=sales_pipeline["lead"],
        to_stage=sales_pipeline["qualified"],
    ).update(conditions={"min_amount": 100000})
    stages = PipelineService().get_available_transitions(deal_in_lead, user)
    stage_ids = {s.pk for s in stages}
    # Qualified is blocked, Lost is still available.
    assert sales_pipeline["qualified"].pk not in stage_ids
    assert sales_pipeline["lost"].pk in stage_ids


###############################################################################
# check_stage_limits
###############################################################################


def test_check_stage_limits_no_limit_returns_clean(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    report = PipelineService().check_stage_limits(deal_in_lead)
    assert report.limit is None
    assert report.stuck is False
    assert report.alert is False
    assert report.days_in_stage == 0


def test_check_stage_limits_flags_stuck_deal(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    sales_pipeline["lead"].business_days_limit = 5
    sales_pipeline["lead"].save(update_fields=["business_days_limit", "updated_at"])
    # Backdate deal.created_at by 10 business days (~14 calendar days).
    ten_business_days_ago = timezone.now() - timedelta(days=14)
    Deal.objects.filter(pk=deal_in_lead.pk).update(created_at=ten_business_days_ago)
    deal_in_lead.refresh_from_db()
    report = PipelineService().check_stage_limits(deal_in_lead)
    assert report.limit == 5
    assert report.stuck is True
    assert report.days_in_stage > 5
    assert report.alert is True


def test_check_stage_limits_healthy_within_limit(sales_pipeline, deal_in_lead, user):  # type: ignore[no-untyped-def]
    sales_pipeline["lead"].business_days_limit = 30
    sales_pipeline["lead"].save(update_fields=["business_days_limit", "updated_at"])
    report = PipelineService().check_stage_limits(deal_in_lead)
    assert report.limit == 30
    assert report.stuck is False
    assert report.alert is False


###############################################################################
# get_pipeline_metrics
###############################################################################


def test_get_pipeline_metrics_per_stage_counts(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    DealFactory.create_batch(2, pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"], amount=Decimal("1000.00"))
    DealFactory.create_batch(3, pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["qualified"], amount=Decimal("2000.00"))
    DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["won"], amount=Decimal("10000.00"))
    metrics = PipelineService().get_pipeline_metrics(sales_pipeline["pipeline"])
    by_stage = {row["stage_name"]: row for row in metrics["stages"]}
    assert by_stage["Lead"]["count"] == 2
    assert by_stage["Qualified"]["count"] == 3
    assert by_stage["Closed Won"]["count"] == 1
    assert by_stage["Lead"]["sum_amount"] == "2000.00"
    assert by_stage["Qualified"]["sum_amount"] == "6000.00"


def test_get_pipeline_metrics_weighted_value(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """Weighted value = sum(amount * probability / 100)."""
    DealFactory(
        pipeline=sales_pipeline["pipeline"],
        stage=sales_pipeline["proposal"],
        amount=Decimal("1000.00"),
        probability=50.0,
    )
    metrics = PipelineService().get_pipeline_metrics(sales_pipeline["pipeline"])
    by_stage = {row["stage_name"]: row for row in metrics["stages"]}
    # 1000 * 50 / 100 = 500.00
    assert by_stage["Proposal"]["weighted_value"] == "500.00"


def test_get_pipeline_metrics_win_rate(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    DealFactory.create_batch(3, pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["won"])
    DealFactory.create_batch(1, pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lost"])
    metrics = PipelineService().get_pipeline_metrics(sales_pipeline["pipeline"])
    totals = metrics["totals"]
    assert totals["won_count"] == 3
    assert totals["lost_count"] == 1
    assert totals["win_rate"] == 0.75


def test_get_pipeline_metrics_forecast_category_propagated(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """Each per-stage row carries the stage's ``forecast_category``."""
    metrics = PipelineService().get_pipeline_metrics(sales_pipeline["pipeline"])
    by_stage = {row["stage_name"]: row for row in metrics["stages"]}
    assert by_stage["Lead"]["forecast_category"] == "pipeline"
    assert by_stage["Proposal"]["forecast_category"] == "best_case"
    assert by_stage["Negotiation"]["forecast_category"] == "commit"
    assert by_stage["Closed Won"]["forecast_category"] == "closed"
    assert by_stage["Closed Lost"]["forecast_category"] == "omitted"


###############################################################################
# get_deal_velocity
###############################################################################


def test_get_deal_velocity_aggregates_durations(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """Avg time in stage = mean(duration_in_previous_stage) for that stage's exits."""
    deal = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"])
    # Simulate two exits from Lead → Qualified with durations 3600s and 7200s.
    DealStageHistoryFactory(
        deal=deal,
        from_stage=sales_pipeline["lead"],
        to_stage=sales_pipeline["qualified"],
        duration_in_previous_stage=3600,
    )
    DealStageHistoryFactory(
        deal=deal,
        from_stage=sales_pipeline["lead"],
        to_stage=sales_pipeline["qualified"],
        duration_in_previous_stage=7200,
    )
    velocity = PipelineService().get_deal_velocity(sales_pipeline["pipeline"])
    by_stage = {row["stage_name"]: row for row in velocity}
    # Avg = (3600 + 7200) / 2 = 5400.
    assert by_stage["Lead"]["avg_seconds"] == 5400.0
    assert by_stage["Lead"]["exited_count"] == 2


def test_get_deal_velocity_stages_with_no_exits_report_zero(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    velocity = PipelineService().get_deal_velocity(sales_pipeline["pipeline"])
    by_stage = {row["stage_name"]: row for row in velocity}
    # No history rows exist yet — every stage reports 0.
    for row in velocity:
        assert row["avg_seconds"] == 0.0
        assert row["exited_count"] == 0
    # Stages still show up so the bar chart can render empty bars.
    assert "Lead" in by_stage
    assert "Closed Won" in by_stage


###############################################################################
# get_stage_conversion_rates
###############################################################################


def test_get_stage_conversion_rates_forward_vs_lost(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """Lead stage: 3 deals moved forward (→ Qualified), 1 lost (→ Lost) ⇒ 0.75 rate."""
    deal1 = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"])
    deal2 = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"])
    deal3 = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"])
    deal4 = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"])
    DealStageHistoryFactory(deal=deal1, from_stage=sales_pipeline["lead"], to_stage=sales_pipeline["qualified"])
    DealStageHistoryFactory(deal=deal2, from_stage=sales_pipeline["lead"], to_stage=sales_pipeline["qualified"])
    DealStageHistoryFactory(deal=deal3, from_stage=sales_pipeline["lead"], to_stage=sales_pipeline["qualified"])
    DealStageHistoryFactory(deal=deal4, from_stage=sales_pipeline["lead"], to_stage=sales_pipeline["lost"])
    rates = PipelineService().get_stage_conversion_rates(sales_pipeline["pipeline"])
    by_stage = {row["stage_name"]: row for row in rates}
    lead_row = by_stage["Lead"]
    assert lead_row["moved_forward"] == 3
    assert lead_row["lost"] == 1
    assert lead_row["conversion_rate"] == 0.75


def test_get_stage_conversion_rates_zero_when_no_exits(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    rates = PipelineService().get_stage_conversion_rates(sales_pipeline["pipeline"])
    for row in rates:
        assert row["moved_forward"] == 0
        assert row["lost"] == 0
        assert row["conversion_rate"] == 0.0


###############################################################################
# get_win_rate_by_stage
###############################################################################


def test_get_win_rate_by_stage_ranks_lossiest_first(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """Proposal loses 5 deals, Negotiation loses 1 — Proposal must rank first."""
    for _ in range(5):
        d = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["proposal"])
        DealStageHistoryFactory(deal=d, from_stage=sales_pipeline["proposal"], to_stage=sales_pipeline["lost"])
    d = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["negotiation"])
    DealStageHistoryFactory(deal=d, from_stage=sales_pipeline["negotiation"], to_stage=sales_pipeline["lost"])
    d = DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["negotiation"])
    DealStageHistoryFactory(deal=d, from_stage=sales_pipeline["negotiation"], to_stage=sales_pipeline["won"])
    out = PipelineService().get_win_rate_by_stage(sales_pipeline["pipeline"])
    # Sorted by lost_count desc.
    assert out[0]["stage_name"] == "Proposal"
    assert out[0]["lost_count"] == 5
    # Negotiation has 1 lost, 1 won ⇒ 0.5 loss_rate.
    neg_row = next(r for r in out if r["stage_name"] == "Negotiation")
    assert neg_row["lost_count"] == 1
    assert neg_row["won_count"] == 1
    assert neg_row["loss_rate"] == 0.5


###############################################################################
# get_monthly_trend
###############################################################################


def test_get_monthly_trend_backfills_empty_months(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """No deals ⇒ still returns ``months`` rows of zeros."""
    trend = PipelineService().get_monthly_trend(sales_pipeline["pipeline"], months=3)
    assert len(trend) == 3
    for row in trend:
        assert row["count"] == 0
        assert row["sum_amount"] == "0"


def test_get_monthly_trend_buckets_deals_by_created_month(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"], amount=Decimal("1000.00"))
    DealFactory(pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["won"], amount=Decimal("5000.00"))
    trend = PipelineService().get_monthly_trend(sales_pipeline["pipeline"], months=6)
    # Current month's row should have both deals.
    current = trend[-1]
    assert current["count"] == 2
    assert current["sum_amount"] == "6000.00"
    assert current["won_count"] == 1


###############################################################################
# get_at_risk_deals
###############################################################################


def test_get_at_risk_deals_flags_stuck_and_overdue(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    sales_pipeline["lead"].business_days_limit = 1
    sales_pipeline["lead"].save(update_fields=["business_days_limit", "updated_at"])
    stuck = DealFactory(
        pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"], name="Stuck"
    )
    # Backdate so it's past the 1-day limit.
    Deal.objects.filter(pk=stuck.pk).update(created_at=timezone.now() - timedelta(days=5))
    overdue = DealFactory(
        pipeline=sales_pipeline["pipeline"],
        stage=sales_pipeline["qualified"],
        name="Overdue",
        close_date=(timezone.now() - timedelta(days=2)).date(),
    )
    healthy = DealFactory(
        pipeline=sales_pipeline["pipeline"], stage=sales_pipeline["lead"], name="Healthy"
    )
    deals = PipelineService().get_at_risk_deals(pipeline=sales_pipeline["pipeline"], tenant=active_tenant)
    names = {d["deal_name"] for d in deals}
    assert "Stuck" in names
    assert "Overdue" in names
    assert "Healthy" not in names


###############################################################################
# Cross-tenant isolation
###############################################################################


def test_pipeline_metrics_tenant_scoped(sales_pipeline, active_tenant, user):  # type: ignore[no-untyped-def]
    """Deals in another tenant must not bleed into this tenant's metrics."""
    from api.factories import OrganizationFactory

    other = OrganizationFactory(subdomain="other", slug="other")
    with tenant_context(other):
        other_pipeline = PipelineFactory(tenant=other, name="Other Pipeline")
        other_lead = StageFactory(tenant=other, pipeline=other_pipeline, name="Other Lead")
        DealFactory.create_batch(5, tenant=other, pipeline=other_pipeline, stage=other_lead)
    # Back in the original tenant.
    set_current_tenant(active_tenant)
    metrics = PipelineService().get_pipeline_metrics(sales_pipeline["pipeline"])
    totals = metrics["totals"]
    assert totals["total_count"] == 0
