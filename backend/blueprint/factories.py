"""factory_boy factories for the blueprint app.

All factories use the shared ``_current_tenant`` / ``_current_user``
helpers from :mod:`api.factories` so they lazily attach the active tenant
(set via ``tenant_context`` in tests) or create one when none exists.

The :class:`BlueprintFactory` uses ``is_active=False`` by default so the
partial unique constraint (one active per pipeline) isn't tripped by
factory.create_batch. Tests that need an *active* blueprint should pass
``is_active=True`` explicitly (and ensure the pipeline doesn't already
have one).
"""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from blueprint.models import (
    Blueprint,
    BlueprintAssignment,
    BlueprintExecution,
    BlueprintFieldRequirement,
    BlueprintState,
    BlueprintTimer,
    BlueprintTransition,
    CONDITION_GREATER_THAN,
    CONDITION_NOT_EMPTY,
    STATE_TYPE_NORMAL,
    TIMER_ACTION_NOTIFY,
)
from deals.factories import DealFactory, PipelineFactory, StageFactory


class BlueprintFactory(DjangoModelFactory):
    """Factory for :class:`blueprint.models.Blueprint`."""

    class Meta:
        model = Blueprint

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Blueprint {n}")
    pipeline = factory.SubFactory(PipelineFactory)
    is_active = False
    is_published = False
    description = factory.Faker("sentence")
    version = 1


class BlueprintStateFactory(DjangoModelFactory):
    """Factory for :class:`blueprint.models.BlueprintState`.

    Defaults to a ``normal`` state with no actions / no time-limit. Tests
    that exercise timers / stuck-deal alerts should override
    ``time_limit_hours`` / ``state_type``.
    """

    class Meta:
        model = BlueprintState

    tenant = factory.LazyFunction(_current_tenant)
    blueprint = factory.SubFactory(BlueprintFactory)
    stage = factory.SubFactory(
        StageFactory, pipeline=factory.SelfAttribute("..blueprint.pipeline")
    )
    state_type = STATE_TYPE_NORMAL
    entry_actions = factory.LazyFunction(lambda: [])
    exit_actions = factory.LazyFunction(lambda: [])
    time_limit_hours = None
    escalation_blueprint = None


class BlueprintTransitionFactory(DjangoModelFactory):
    """Factory for :class:`blueprint.models.BlueprintTransition`.

    Defaults to a no-frills edge: any role, no conditions, no required
    fields, no approval gate, no post-transition actions. Override
    ``allowed_roles`` / ``conditions`` / ``require_fields`` /
    ``require_approval`` / ``post_transition_actions`` in the test to
    exercise the guards.
    """

    class Meta:
        model = BlueprintTransition

    tenant = factory.LazyFunction(_current_tenant)
    blueprint = factory.SubFactory(BlueprintFactory)
    from_state = factory.SubFactory(
        BlueprintStateFactory, blueprint=factory.SelfAttribute("..blueprint")
    )
    to_state = factory.SubFactory(
        BlueprintStateFactory, blueprint=factory.SelfAttribute("..blueprint")
    )
    allowed_roles = factory.LazyFunction(lambda: [])
    conditions = factory.LazyFunction(lambda: {})
    require_fields = factory.LazyFunction(lambda: [])
    require_approval = None
    post_transition_actions = factory.LazyFunction(lambda: [])


class BlueprintFieldRequirementFactory(DjangoModelFactory):
    """Factory for :class:`blueprint.models.BlueprintFieldRequirement`."""

    class Meta:
        model = BlueprintFieldRequirement

    tenant = factory.LazyFunction(_current_tenant)
    transition = factory.SubFactory(BlueprintTransitionFactory)
    field_name = "amount"
    condition = CONDITION_NOT_EMPTY
    value = ""


class BlueprintAssignmentFactory(DjangoModelFactory):
    """Factory for :class:`blueprint.models.BlueprintAssignment`."""

    class Meta:
        model = BlueprintAssignment

    tenant = factory.LazyFunction(_current_tenant)
    transition = factory.SubFactory(BlueprintTransitionFactory)
    assign_to = "role"
    assign_value = "admin"


class BlueprintTimerFactory(DjangoModelFactory):
    """Factory for :class:`blueprint.models.BlueprintTimer`."""

    class Meta:
        model = BlueprintTimer

    tenant = factory.LazyFunction(_current_tenant)
    state = factory.SubFactory(BlueprintStateFactory)
    hours = 24
    action = TIMER_ACTION_NOTIFY
    target_state = None
    notify_roles = factory.LazyFunction(lambda: ["admin"])
    escalate_to = ""


class BlueprintExecutionFactory(DjangoModelFactory):
    """Factory for :class:`blueprint.models.BlueprintExecution`.

    Defaults ``entered_state_at`` to the deal's ``created_at`` so the
    timer math is consistent with :meth:`BlueprintService.enforce_on_create`.
    """

    class Meta:
        model = BlueprintExecution

    tenant = factory.LazyFunction(_current_tenant)
    deal = factory.SubFactory(DealFactory)
    blueprint = factory.SubFactory(BlueprintFactory)
    current_state = factory.SubFactory(
        BlueprintStateFactory, blueprint=factory.SelfAttribute("..blueprint")
    )
    entered_state_at = factory.LazyAttribute(lambda obj: obj.deal.created_at)
    history = factory.LazyFunction(lambda: [])
    is_complete = False


__all__ = [
    "BlueprintAssignmentFactory",
    "BlueprintExecutionFactory",
    "BlueprintFactory",
    "BlueprintFieldRequirementFactory",
    "BlueprintStateFactory",
    "BlueprintTimerFactory",
    "BlueprintTransitionFactory",
]
