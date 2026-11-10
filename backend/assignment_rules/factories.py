"""factory_boy factories for the assignment_rules app."""

from __future__ import annotations

import factory
from django.utils import timezone
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from assignment_rules.models import (
    AssignmentHistory,
    AssignmentRule,
    STRATEGY_ROUND_ROBIN,
)


class AssignmentRuleFactory(DjangoModelFactory):
    """Factory for :class:`assignment_rules.models.AssignmentRule`.

    Defaults to a ``round_robin`` rule on ``deal`` with ``assign_to=[]``
    (so the service returns ``None`` and the rule effectively no-ops).
    Override ``strategy`` / ``assign_to`` / ``criteria`` / ``target_model``
    in the test to exercise the other strategies.
    """

    class Meta:
        model = AssignmentRule

    tenant = factory.LazyFunction(_current_tenant)
    target_model = "deal"
    criteria = factory.LazyFunction(lambda: {})
    strategy = STRATEGY_ROUND_ROBIN
    assign_to = factory.LazyFunction(lambda: [])
    fallback_user = None
    territory_field = ""
    is_active = True


class AssignmentHistoryFactory(DjangoModelFactory):
    """Factory for :class:`assignment_rules.models.AssignmentHistory`."""

    class Meta:
        model = AssignmentHistory

    tenant = factory.LazyFunction(_current_tenant)
    rule = factory.SubFactory(AssignmentRuleFactory)
    record_module = "deal"
    record_id = factory.Sequence(lambda n: str(n + 1))
    assigned_to = factory.LazyFunction(_current_user)
    assigned_at = factory.LazyFunction(timezone.now)


__all__ = ["AssignmentHistoryFactory", "AssignmentRuleFactory"]
