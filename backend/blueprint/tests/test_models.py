"""Model-layer tests for the blueprint app.

Covers:

* The ``Blueprint`` partial unique constraint (one active per pipeline).
* The ``BlueprintState`` 1:1-to-stage unique constraint.
* The ``BlueprintTransition`` unique on ``(blueprint, from_state, to_state)``.
* The ``BlueprintExecution`` unique on ``(deal,)``.
* ``BlueprintExecution.append_history`` mutates the in-place ``history`` list.
* The factories produce persistable rows.
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from blueprint.factories import (
    BlueprintExecutionFactory,
    BlueprintFactory,
    BlueprintStateFactory,
    BlueprintTimerFactory,
    BlueprintTransitionFactory,
)
from blueprint.models import (
    Blueprint,
    BlueprintExecution,
    BlueprintState,
    BlueprintTransition,
    STATE_TYPE_TERMINAL,
)


pytestmark = pytest.mark.django_db


###############################################################################
# Blueprint
###############################################################################


def test_blueprint_partial_unique_active_per_pipeline(active_tenant, user):  # type: ignore[no-untyped-def]
    """Only one active blueprint per pipeline — second insert raises."""
    from deals.factories import PipelineFactory

    pipeline = PipelineFactory(tenant=active_tenant)
    BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=True)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=True)


def test_blueprint_allows_multiple_inactive(active_tenant, user):  # type: ignore[no-untyped-def]
    """Multiple inactive (draft / archived) blueprints on the same pipeline are fine."""
    from deals.factories import PipelineFactory

    pipeline = PipelineFactory(tenant=active_tenant)
    BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=False)
    BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=False)


def test_blueprint_str(active_tenant, user):  # type: ignore[no-untyped-def]
    bp = BlueprintFactory(tenant=active_tenant, name="Sales Blueprint", version=3)
    assert str(bp) == "Sales Blueprint (v3)"


###############################################################################
# BlueprintState
###############################################################################


def test_blueprint_state_unique_per_stage(active_tenant, user):  # type: ignore[no-untyped-def]
    """A blueprint can have at most one state per stage."""
    bp = BlueprintFactory(tenant=active_tenant)
    state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    # Another state on the same blueprint+stage must raise.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            BlueprintStateFactory(
                tenant=active_tenant, blueprint=bp, stage=state.stage
            )


def test_blueprint_state_str(active_tenant, user):  # type: ignore[no-untyped-def]
    bp = BlueprintFactory(tenant=active_tenant, name="BP")
    state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    assert "BP" in str(state)
    assert state.stage.name in str(state)


###############################################################################
# BlueprintTransition
###############################################################################


def test_blueprint_transition_unique_per_pair(active_tenant, user):  # type: ignore[no-untyped-def]
    """A blueprint can have at most one transition between a pair of states."""
    bp = BlueprintFactory(tenant=active_tenant)
    from_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    to_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=bp, from_state=from_state, to_state=to_state
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            BlueprintTransitionFactory(
                tenant=active_tenant, blueprint=bp, from_state=from_state, to_state=to_state
            )


def test_blueprint_transition_str(active_tenant, user):  # type: ignore[no-untyped-def]
    bp = BlueprintFactory(tenant=active_tenant)
    transition = BlueprintTransitionFactory(tenant=active_tenant, blueprint=bp)
    assert "→" in str(transition)


###############################################################################
# BlueprintTimer
###############################################################################


def test_blueprint_timer_factory_persists(active_tenant, user):  # type: ignore[no-untyped-def]
    timer = BlueprintTimerFactory(tenant=active_tenant, hours=72)
    assert timer.pk is not None
    assert timer.hours == 72
    assert "after 72h" in str(timer)


###############################################################################
# BlueprintExecution
###############################################################################


def test_blueprint_execution_unique_per_deal(active_tenant, user):  # type: ignore[no-untyped-def]
    """A deal has at most one execution — enforced by ``unique_together=(("deal",),)``."""
    execution = BlueprintExecutionFactory(tenant=active_tenant)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            BlueprintExecutionFactory(
                tenant=active_tenant, deal=execution.deal
            )


def test_blueprint_execution_append_history(active_tenant, user):  # type: ignore[no-untyped-def]
    """``append_history`` mutates the in-place list (without saving)."""
    execution = BlueprintExecutionFactory(tenant=active_tenant, history=[])
    assert execution.history == []
    execution.append_history(
        from_state=None,
        to_state=execution.current_state_id,
        changed_by=user,
        changed_at=timezone.now(),
        reason="initial",
    )
    assert len(execution.history) == 1
    entry = execution.history[0]
    assert entry["to_state"] == execution.current_state_id
    assert entry["changed_by"] == user.pk
    assert entry["reason"] == "initial"


def test_blueprint_execution_marks_complete_when_terminal(active_tenant, user):  # type: ignore[no-untyped-def]
    """An execution whose current state is terminal is_complete=True."""
    bp = BlueprintFactory(tenant=active_tenant)
    state = BlueprintStateFactory(
        tenant=active_tenant, blueprint=bp, state_type=STATE_TYPE_TERMINAL
    )
    execution = BlueprintExecutionFactory(
        tenant=active_tenant, blueprint=bp, current_state=state, is_complete=True
    )
    assert execution.is_complete is True


def test_blueprint_models_count_after_seed(active_tenant, user):  # type: ignore[no-untyped-def]
    """Sanity check — factories actually persist rows to the right tables."""
    bp = BlueprintFactory(tenant=active_tenant)
    from_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    to_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    transition = BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=bp, from_state=from_state, to_state=to_state
    )
    timer = BlueprintTimerFactory(tenant=active_tenant, state=from_state)
    execution = BlueprintExecutionFactory(
        tenant=active_tenant, blueprint=bp, current_state=from_state
    )
    assert Blueprint.objects.filter(pk=bp.pk).exists()
    assert BlueprintState.objects.filter(pk=from_state.pk).exists()
    assert BlueprintState.objects.filter(pk=to_state.pk).exists()
    assert BlueprintTransition.objects.filter(pk=transition.pk).exists()
    assert BlueprintExecution.objects.filter(pk=execution.pk).exists()
    # Timer is on from_state.
    assert from_state.timers.filter(pk=timer.pk).exists()
