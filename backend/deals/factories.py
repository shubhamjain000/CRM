"""factory_boy factories for the deals app.

The Phase-8 ``ApprovalProcessFactory`` lived here when ``ApprovalProcess``
was a stub in :mod:`deals.models`. Phase 10 promoted the model to the
``approvals`` app — the factory now lives there too. We re-export it from
here so existing tests that ``from deals.factories import
ApprovalProcessFactory`` keep working.
"""

from __future__ import annotations

from decimal import Decimal

import factory
from django.utils import timezone
from factory.django import DjangoModelFactory

from accounts.factories import AccountFactory
from approvals.factories import ApprovalProcessFactory  # re-exported
from api.factories import _current_tenant, _current_user
from contacts.factories import ContactFactory
from deals.models import Deal, DealStageHistory, StageTransition
from deals.models_pipeline import Pipeline, Stage


class PipelineFactory(DjangoModelFactory):
    class Meta:
        model = Pipeline

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Pipeline {n}")
    is_default = False
    description = ""


class StageFactory(DjangoModelFactory):
    class Meta:
        model = Stage

    tenant = factory.LazyFunction(_current_tenant)
    pipeline = factory.SubFactory(PipelineFactory)
    name = factory.Sequence(lambda n: f"Stage {n}")
    probability = factory.Faker("random_int", min=0, max=100)
    order = factory.Sequence(lambda n: n)
    is_won_stage = False
    is_lost_stage = False
    forecast_category = "pipeline"
    is_locked = False
    color = "#3b82f6"
    icon = ""


class WonStageFactory(StageFactory):
    """Specialised factory for terminal won stages (probability 100)."""

    name = factory.Sequence(lambda n: f"Won Stage {n}")
    is_won_stage = True
    is_lost_stage = False
    probability = 100.0
    forecast_category = "closed"
    order = 100


class LostStageFactory(StageFactory):
    """Specialised factory for terminal lost stages (probability 0)."""

    name = factory.Sequence(lambda n: f"Lost Stage {n}")
    is_won_stage = False
    is_lost_stage = True
    probability = 0.0
    forecast_category = "omitted"
    order = 101


class StageTransitionFactory(DjangoModelFactory):
    """Factory for :class:`deals.models.StageTransition`.

    Defaults to a no-frills edge: any role, no conditions, no approval
    gate. Override ``allowed_roles`` / ``conditions`` / ``require_approval``
    in the test to exercise the guards.
    """

    class Meta:
        model = StageTransition

    tenant = factory.LazyFunction(_current_tenant)
    pipeline = factory.SubFactory(PipelineFactory)
    from_stage = factory.SubFactory(StageFactory, pipeline=factory.SelfAttribute("..pipeline"))
    to_stage = factory.SubFactory(StageFactory, pipeline=factory.SelfAttribute("..pipeline"))
    allowed_roles = factory.LazyFunction(lambda: [])
    conditions = factory.LazyFunction(lambda: {})
    require_approval = None


class DealFactory(DjangoModelFactory):
    class Meta:
        model = Deal

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Deal {n}")
    amount = Decimal("10000.00")
    currency = "USD"
    stage = factory.SubFactory(StageFactory)
    pipeline = factory.LazyAttribute(lambda obj: obj.stage.pipeline)
    close_date = None
    probability = 50.0
    forecast_category = factory.LazyAttribute(lambda obj: obj.stage.forecast_category)
    account = factory.SubFactory(AccountFactory)
    primary_contact = factory.SubFactory(ContactFactory)
    owner = factory.LazyFunction(_current_user)
    lead_source = "web"
    type = "new_business"
    next_step = ""
    description = factory.Faker("sentence")
    lost_reason = ""
    competitors = factory.LazyFunction(lambda: [])


class DealStageHistoryFactory(DjangoModelFactory):
    """Factory for :class:`deals.models.DealStageHistory`.

    Defaults ``duration_in_previous_stage`` to zero; tests that exercise
    the velocity / avg-time-in-stage metrics should override it.
    """

    class Meta:
        model = DealStageHistory

    tenant = factory.LazyFunction(_current_tenant)
    deal = factory.SubFactory(DealFactory)
    from_stage = factory.LazyAttribute(lambda obj: obj.deal.stage)
    to_stage = factory.LazyAttribute(lambda obj: obj.deal.stage)
    changed_by = factory.LazyFunction(_current_user)
    changed_at = factory.LazyFunction(timezone.now)
    reason = ""
    duration_in_previous_stage = 0
