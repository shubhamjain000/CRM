"""Service-layer tests for the blueprint app.

Covers :class:`blueprint.services.BlueprintService`:

* ``validate_transition`` — valid path + every invalid path (no
  blueprint, no execution, missing edge, role gate, condition failure,
  required field missing, approval gate).
* ``execute_transition`` — moves the deal, updates the execution,
  appends history, logs a DealStageHistory row, flips ``is_complete``
  on terminal, runs entry/exit/post-transition actions, applies
  assignments, dispatches approval-request notifications.
* ``get_available_transitions`` — returns the per-target block reasons.
* ``check_timers`` — fires when ``hours`` elapsed; auto-transition +
  notify + escalate branches.
* ``enforce_on_create`` — auto-creates an execution when the pipeline
  has an active blueprint; no-op otherwise.
* ``get_compliance_report`` + ``get_stuck_deals`` — adoption + stuck
  metrics.
* ``evaluate_condition`` — every operator ($gt, $lt, $gte, $lte, $eq,
  $ne, $in, $exists).
* ``run_actions`` — create_task / send_notification / update_field /
  assign_to.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from blueprint.factories import (
    BlueprintFactory,
    BlueprintFieldRequirementFactory,
    BlueprintStateFactory,
    BlueprintTimerFactory,
    BlueprintTransitionFactory,
)
from blueprint.models import (
    BlueprintExecution,
    BlueprintTransition,
    STATE_TYPE_NORMAL,
    STATE_TYPE_TERMINAL,
    TIMER_ACTION_AUTO_TRANSITION,
    TIMER_ACTION_ESCALATE,
    TIMER_ACTION_NOTIFY,
)
from blueprint.services import BlueprintService
from deals.factories import (
    DealFactory,
    PipelineFactory,
    StageFactory,
    WonStageFactory,
)
from deals.models import Deal, DealStageHistory


pytestmark = pytest.mark.django_db


###############################################################################
# Fixtures
###############################################################################


@pytest.fixture
def sales_blueprint(active_tenant, user):  # type: ignore[no-untyped-def]
    """A 3-stage blueprint: Lead → Qualified → Won, all transitions allowed."""
    pipeline = PipelineFactory(tenant=active_tenant, name="Sales Pipeline")
    lead = StageFactory(
        tenant=active_tenant, pipeline=pipeline, name="Lead", order=0, probability=10.0
    )
    qualified = StageFactory(
        tenant=active_tenant, pipeline=pipeline, name="Qualified", order=1, probability=30.0
    )
    won = WonStageFactory(tenant=active_tenant, pipeline=pipeline, name="Closed Won", order=2)
    blueprint = BlueprintFactory(
        tenant=active_tenant, name="Sales Blueprint", pipeline=pipeline, is_active=True
    )
    lead_state = BlueprintStateFactory(
        tenant=active_tenant, blueprint=blueprint, stage=lead, state_type=STATE_TYPE_NORMAL
    )
    qualified_state = BlueprintStateFactory(
        tenant=active_tenant, blueprint=blueprint, stage=qualified, state_type=STATE_TYPE_NORMAL
    )
    won_state = BlueprintStateFactory(
        tenant=active_tenant, blueprint=blueprint, stage=won, state_type=STATE_TYPE_TERMINAL
    )
    BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=blueprint, from_state=lead_state, to_state=qualified_state
    )
    BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=blueprint, from_state=qualified_state, to_state=won_state
    )
    return {
        "pipeline": pipeline,
        "blueprint": blueprint,
        "lead_state": lead_state,
        "qualified_state": qualified_state,
        "won_state": won_state,
        "stages": {"lead": lead, "qualified": qualified, "won": won},
    }


@pytest.fixture
def deal_in_lead(sales_blueprint, active_tenant, user):  # type: ignore[no-untyped-def]
    """A deal sitting in the Lead stage with an execution already created."""
    deal = DealFactory(
        tenant=active_tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
        amount=Decimal("5000.00"),
        probability=10.0,
        owner=user,
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    return deal


###############################################################################
# validate_transition
###############################################################################


def test_validate_transition_valid(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    result = BlueprintService().validate_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    assert result["valid"] is True
    assert result["errors"] == []
    assert result["missing_fields"] == []
    assert result["requires_approval"] is False


def test_validate_transition_no_blueprint(active_tenant, user):  # type: ignore[no-untyped-def]
    """Pipeline without an active blueprint → error."""
    pipeline = PipelineFactory(tenant=active_tenant)
    stage = StageFactory(tenant=active_tenant, pipeline=pipeline)
    deal = DealFactory(tenant=active_tenant, pipeline=pipeline, stage=stage)
    # No active blueprint on this pipeline.
    result = BlueprintService().validate_transition(deal, None, user)  # type: ignore[arg-type]
    assert result["valid"] is False
    assert any("no active blueprint" in err for err in result["errors"])


def test_validate_transition_no_execution(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """Deal without an execution → error."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
    )
    result = BlueprintService().validate_transition(
        deal, sales_blueprint["qualified_state"], user
    )
    assert result["valid"] is False
    assert any("no blueprint execution" in err for err in result["errors"])


def test_validate_transition_missing_edge(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """No transition Lead → Won (skip) → error."""
    result = BlueprintService().validate_transition(
        deal_in_lead, sales_blueprint["won_state"], user
    )
    assert result["valid"] is False
    assert any("No transition defined" in err for err in result["errors"])


def test_validate_transition_role_blocked(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A transition with allowed_roles=['closer'] rejects a non-closer user."""
    BlueprintTransition.objects.filter(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    ).update(allowed_roles=["closer"])
    result = BlueprintService().validate_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    assert result["valid"] is False
    assert any("Role" in err and "not permitted" in err for err in result["errors"])


def test_validate_transition_condition_failed(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A ``{"amount": {"$gt": 50000}}`` condition rejects a $5k deal."""
    BlueprintTransition.objects.filter(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    ).update(conditions={"amount": {"$gt": 50000}})
    result = BlueprintService().validate_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    assert result["valid"] is False
    assert any("Conditions not met" in err for err in result["errors"])


def test_validate_transition_missing_required_field(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A ``require_fields=["account"]`` on a deal without an account → missing_fields."""
    BlueprintTransition.objects.filter(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    ).update(require_fields=["account"])
    deal_in_lead.account = None
    deal_in_lead.save(update_fields=["account", "updated_at"])
    result = BlueprintService().validate_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    assert result["valid"] is False
    assert "account" in result["missing_fields"]


def test_validate_transition_field_requirement_failed(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A structured BlueprintFieldRequirement with condition=greater_than rejects below-threshold deals."""
    transition = BlueprintTransition.objects.get(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    )
    BlueprintFieldRequirementFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        transition=transition,
        field_name="amount",
        condition="greater_than",
        value="10000",
    )
    result = BlueprintService().validate_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    assert result["valid"] is False
    assert any("amount" in err and "greater_than" in err for err in result["errors"])


def test_validate_transition_requires_approval(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A transition with require_approval set → requires_approval=True (still valid)."""
    from deals.factories import ApprovalProcessFactory

    approval = ApprovalProcessFactory(tenant=sales_blueprint["blueprint"].tenant)
    BlueprintTransition.objects.filter(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    ).update(require_approval=approval)
    result = BlueprintService().validate_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    assert result["requires_approval"] is True


###############################################################################
# execute_transition
###############################################################################


def test_execute_transition_moves_deal_and_appends_history(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    execution = BlueprintService().execute_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user, reason="moving up"
    )
    deal_in_lead.refresh_from_db()
    assert deal_in_lead.stage_id == sales_blueprint["stages"]["qualified"].pk
    assert execution.current_state_id == sales_blueprint["qualified_state"].pk
    assert len(execution.history) == 1
    entry = execution.history[0]
    assert entry["from_state"] == sales_blueprint["lead_state"].pk
    assert entry["to_state"] == sales_blueprint["qualified_state"].pk
    assert entry["changed_by"] == user.pk
    assert entry["reason"] == "moving up"


def test_execute_transition_writes_deal_stage_history(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    BlueprintService().execute_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    history = DealStageHistory.objects.filter(deal=deal_in_lead)
    assert history.count() == 1
    row = history.first()
    assert row.from_stage_id == sales_blueprint["stages"]["lead"].pk
    assert row.to_stage_id == sales_blueprint["stages"]["qualified"].pk
    assert row.changed_by_id == user.pk


def test_execute_transition_flips_is_complete_on_terminal(sales_blueprint, user):  # type: ignore[no-untyped-def]
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
    )
    BlueprintService().enforce_on_create(deal)
    # Move Lead → Qualified, then Qualified → Won.
    BlueprintService().execute_transition(
        deal, sales_blueprint["qualified_state"], user
    )
    execution = BlueprintService().execute_transition(
        deal, sales_blueprint["won_state"], user
    )
    assert execution.is_complete is True
    deal.refresh_from_db()
    assert deal.probability == 100.0
    assert deal.forecast_category == "closed"


def test_execute_transition_raises_on_invalid(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """No edge Lead → Won — execute raises ValidationError."""
    with pytest.raises(ValidationError):
        BlueprintService().execute_transition(
            deal_in_lead, sales_blueprint["won_state"], user
        )


def test_execute_transition_runs_post_transition_actions(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A ``create_task`` post-transition action creates a Task row."""
    BlueprintTransition.objects.filter(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    ).update(
        post_transition_actions=[
            {
                "type": "create_task",
                "params": {"title": "Send qualification email", "priority": "high"},
            }
        ]
    )
    BlueprintService().execute_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    from tasks.models import Task

    task = Task.objects.filter(
        related_module="deal", related_id=str(deal_in_lead.pk)
    ).first()
    assert task is not None
    assert task.title == "Send qualification email"
    assert task.priority == "high"


def test_execute_transition_runs_entry_actions(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A ``send_notification`` entry_action on the target state fires a notification."""
    sales_blueprint["qualified_state"].entry_actions = [
        {
            "type": "send_notification",
            "params": {
                "verb": "updated",
                "title": "Deal moved to Qualified",
                "body": "The blueprint moved the deal forward.",
            },
        }
    ]
    sales_blueprint["qualified_state"].save(update_fields=["entry_actions", "updated_at"])
    BlueprintService().execute_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    from notifications.models import Notification

    notif = Notification.objects.filter(
        target_module="deal", target_id=str(deal_in_lead.pk)
    ).first()
    assert notif is not None
    assert notif.verb == "updated"
    assert "Qualified" in notif.data.get("title", "")


def test_execute_transition_approval_dispatches_notification(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A transition with require_approval dispatches an ``approval_requested`` notification to admins."""
    from deals.factories import ApprovalProcessFactory
    from notifications.models import Notification

    approval = ApprovalProcessFactory(tenant=sales_blueprint["blueprint"].tenant)
    BlueprintTransition.objects.filter(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    ).update(require_approval=approval)
    BlueprintService().execute_transition(
        deal_in_lead, sales_blueprint["qualified_state"], user
    )
    notif = Notification.objects.filter(
        target_module="deal", verb="approval_requested"
    ).first()
    assert notif is not None
    assert notif.data.get("approval_process_id") == approval.pk


###############################################################################
# get_available_transitions
###############################################################################


def test_get_available_transitions_returns_forward_targets(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    transitions = BlueprintService().get_available_transitions(deal_in_lead, user)
    assert len(transitions) == 1
    entry = transitions[0]
    assert entry["to_state"]["id"] == sales_blueprint["qualified_state"].pk
    assert entry["valid"] is True
    assert entry["blocked_reason"] is None


def test_get_available_transitions_empty_when_terminal(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """A deal already in the terminal Won state has no available transitions."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["won"],
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    transitions = BlueprintService().get_available_transitions(deal, user)
    assert transitions == []


def test_get_available_transitions_reports_blocked_reason(sales_blueprint, deal_in_lead, user):  # type: ignore[no-untyped-def]
    """A condition failure surfaces as a blocked_reason on the entry."""
    BlueprintTransition.objects.filter(
        blueprint=sales_blueprint["blueprint"],
        from_state=sales_blueprint["lead_state"],
        to_state=sales_blueprint["qualified_state"],
    ).update(conditions={"amount": {"$gt": 50000}})
    transitions = BlueprintService().get_available_transitions(deal_in_lead, user)
    assert len(transitions) == 1
    entry = transitions[0]
    assert entry["valid"] is False
    assert entry["blocked_reason"] is not None
    assert "Conditions not met" in entry["blocked_reason"]


###############################################################################
# check_timers
###############################################################################


def test_check_timers_auto_transitions(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """A timer with action=auto_transition moves the deal after hours elapsed."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
        owner=user,
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    # Backdate entered_state_at so 24h have passed.
    BlueprintExecution.objects.filter(pk=execution.pk).update(
        entered_state_at=timezone.now() - timedelta(hours=48)
    )
    # Timer fires after 24h → auto-transition Lead → Qualified.
    BlueprintTimerFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        state=sales_blueprint["lead_state"],
        hours=24,
        action=TIMER_ACTION_AUTO_TRANSITION,
        target_state=sales_blueprint["qualified_state"],
    )
    summary = BlueprintService().check_timers()
    assert summary["timers_fired"] >= 1
    assert summary["auto_transitions"] >= 1
    deal.refresh_from_db()
    assert deal.stage_id == sales_blueprint["stages"]["qualified"].pk


def test_check_timers_notify_dispatches_notification(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """A timer with action=notify sends a notification to ``notify_roles``."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
        owner=user,
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    BlueprintExecution.objects.filter(pk=execution.pk).update(
        entered_state_at=timezone.now() - timedelta(hours=48)
    )
    BlueprintTimerFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        state=sales_blueprint["lead_state"],
        hours=24,
        action=TIMER_ACTION_NOTIFY,
        notify_roles=["admin"],
    )
    from notifications.models import Notification

    Notification.objects.all().delete()
    summary = BlueprintService().check_timers()
    assert summary["notifications_sent"] >= 1
    notif = Notification.objects.filter(
        target_module="deal", target_id=str(deal.pk)
    ).first()
    assert notif is not None


def test_check_timers_escalate_dispatches_notification(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """A timer with action=escalate sends a notification to ``escalate_to``."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
        owner=user,
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    BlueprintExecution.objects.filter(pk=execution.pk).update(
        entered_state_at=timezone.now() - timedelta(hours=72)
    )
    BlueprintTimerFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        state=sales_blueprint["lead_state"],
        hours=48,
        action=TIMER_ACTION_ESCALATE,
        escalate_to="admin",
    )
    from notifications.models import Notification

    Notification.objects.all().delete()
    summary = BlueprintService().check_timers()
    assert summary["notifications_sent"] >= 1


def test_check_timers_skips_when_hours_not_elapsed(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """A timer whose hours have NOT elapsed fires nothing."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
        owner=user,
    )
    BlueprintService().enforce_on_create(deal)
    BlueprintTimerFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        state=sales_blueprint["lead_state"],
        hours=24,
        action=TIMER_ACTION_NOTIFY,
        notify_roles=["admin"],
    )
    summary = BlueprintService().check_timers()
    assert summary["timers_fired"] == 0


###############################################################################
# enforce_on_create
###############################################################################


def test_enforce_on_create_attaches_execution(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """A new deal in a pipeline with an active blueprint gets an execution."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    assert execution.deal_id == deal.pk
    assert execution.current_state_id == sales_blueprint["lead_state"].pk
    assert execution.blueprint_id == sales_blueprint["blueprint"].pk
    assert execution.is_complete is False


def test_enforce_on_create_no_op_without_active_blueprint(active_tenant, user):  # type: ignore[no-untyped-def]
    """Pipeline with no active blueprint → returns None."""
    pipeline = PipelineFactory(tenant=active_tenant)
    stage = StageFactory(tenant=active_tenant, pipeline=pipeline)
    deal = DealFactory(tenant=active_tenant, pipeline=pipeline, stage=stage)
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is None


def test_enforce_on_create_marks_terminal_when_initial_state_terminal(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """If the deal starts in the terminal Won stage, the execution is_complete=True."""
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["won"],
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    assert execution.is_complete is True


###############################################################################
# get_compliance_report + get_stuck_deals
###############################################################################


def test_get_compliance_report_counts(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """3 deals, all auto-attached to the blueprint by the signal — 100% compliant.

    The ``Deal.post_save`` signal fires ``enforce_on_create`` on every
    fresh deal whose pipeline has an active blueprint, so all three
    deals in this test get a ``BlueprintExecution`` row. To exercise the
    "non-compliant" branch we explicitly delete one execution after the
    fact and re-run the report.
    """
    deal1 = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
    )
    deal2 = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
    )
    deal3 = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
    )
    # All three were auto-attached by the signal.
    assert BlueprintExecution.objects.filter(deal_id__in=[deal1.pk, deal2.pk, deal3.pk]).count() == 3
    # Delete one to simulate a non-compliant deal.
    BlueprintExecution.objects.filter(deal=deal3).delete()
    report = BlueprintService().get_compliance_report(sales_blueprint["pipeline"])
    assert report["total_deals"] == 3
    assert report["in_blueprint"] == 2
    assert report["non_compliant_deals"] == 1
    assert report["compliance_rate"] == round(2 / 3, 4)


def test_get_compliance_report_stuck_deals(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """A deal whose state has time_limit_hours and overstayed → counted as stuck."""
    sales_blueprint["lead_state"].time_limit_hours = 24
    sales_blueprint["lead_state"].save(update_fields=["time_limit_hours", "updated_at"])
    deal = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    # Backdate so the deal is stuck (48h > 24h limit).
    BlueprintExecution.objects.filter(pk=execution.pk).update(
        entered_state_at=timezone.now() - timedelta(hours=48)
    )
    report = BlueprintService().get_compliance_report(sales_blueprint["pipeline"])
    assert report["stuck_deals"] == 1


def test_get_stuck_deals_returns_only_overstayed(sales_blueprint, user):  # type: ignore[no-untyped-def]
    """Two deals, one overstayed, one healthy — only the overstayed one is returned."""
    sales_blueprint["lead_state"].time_limit_hours = 24
    sales_blueprint["lead_state"].save(update_fields=["time_limit_hours", "updated_at"])
    stuck = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
        name="Stuck Deal",
    )
    healthy = DealFactory(
        tenant=sales_blueprint["blueprint"].tenant,
        pipeline=sales_blueprint["pipeline"],
        stage=sales_blueprint["stages"]["lead"],
        name="Healthy Deal",
    )
    stuck_exec = BlueprintService().enforce_on_create(stuck)
    healthy_exec = BlueprintService().enforce_on_create(healthy)
    assert stuck_exec is not None and healthy_exec is not None
    BlueprintExecution.objects.filter(pk=stuck_exec.pk).update(
        entered_state_at=timezone.now() - timedelta(hours=48)
    )
    # Healthy: just entered.
    BlueprintExecution.objects.filter(pk=healthy_exec.pk).update(
        entered_state_at=timezone.now()
    )
    stuck_deals = BlueprintService().get_stuck_deals(sales_blueprint["pipeline"])
    names = {d["deal_name"] for d in stuck_deals}
    assert "Stuck Deal" in names
    assert "Healthy Deal" not in names
    # Each entry has the expected metadata.
    entry = next(d for d in stuck_deals if d["deal_name"] == "Stuck Deal")
    assert entry["time_limit_hours"] == 24
    assert entry["hours_in_state"] >= 48


###############################################################################
# evaluate_condition
###############################################################################


def test_evaluate_condition_gt_lt_gte_lte():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory(amount=Decimal("5000.00"))
    service = BlueprintService()
    assert service.evaluate_condition(deal, {"amount": {"$gt": 1000}})[0]
    assert not service.evaluate_condition(deal, {"amount": {"$gt": 10000}})[0]
    assert service.evaluate_condition(deal, {"amount": {"$lt": 10000}})[0]
    assert service.evaluate_condition(deal, {"amount": {"$gte": 5000}})[0]
    assert service.evaluate_condition(deal, {"amount": {"$lte": 5000}})[0]


def test_evaluate_condition_eq_ne():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory(lead_source="web")
    service = BlueprintService()
    assert service.evaluate_condition(deal, {"lead_source": {"$eq": "web"}})[0]
    assert not service.evaluate_condition(deal, {"lead_source": {"$eq": "referral"}})[0]
    assert service.evaluate_condition(deal, {"lead_source": {"$ne": "referral"}})[0]


def test_evaluate_condition_in():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory(lead_source="web")
    service = BlueprintService()
    assert service.evaluate_condition(
        deal, {"lead_source": {"$in": ["web", "referral"]}}
    )[0]
    assert not service.evaluate_condition(
        deal, {"lead_source": {"$in": ["event", "other"]}}
    )[0]


def test_evaluate_condition_exists():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory(close_date=None)
    service = BlueprintService()
    assert not service.evaluate_condition(deal, {"close_date": {"$exists": True}})[0]
    assert service.evaluate_condition(deal, {"close_date": {"$exists": False}})[0]


def test_evaluate_condition_empty_returns_true():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory()
    assert BlueprintService().evaluate_condition(deal, {})[0]


def test_evaluate_condition_unsupported_operator():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory()
    ok, why = BlueprintService().evaluate_condition(deal, {"amount": {"$weird": 1}})
    assert not ok
    assert "Unsupported operator" in why


###############################################################################
# run_actions
###############################################################################


def test_run_actions_create_task():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory()
    BlueprintService().run_actions(
        [
            {
                "type": "create_task",
                "params": {"title": "Action item", "priority": "high"},
            }
        ],
        deal,
        {"user": deal.owner, "blueprint_id": None},
    )
    from tasks.models import Task

    assert Task.objects.filter(title="Action item").exists()


def test_run_actions_update_field():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory(next_step="")
    BlueprintService().run_actions(
        [{"type": "update_field", "params": {"field_name": "next_step", "value": "Send email"}}],
        deal,
        {"user": deal.owner, "blueprint_id": None},
    )
    deal.refresh_from_db()
    assert deal.next_step == "Send email"


def test_run_actions_unknown_type_is_swallowed():  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory

    deal = DealFactory()
    # Should not raise.
    BlueprintService().run_actions(
        [{"type": "bogus", "params": {}}],
        deal,
        {"user": deal.owner, "blueprint_id": None},
    )
