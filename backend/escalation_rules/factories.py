"""factory_boy factories for the escalation_rules app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from escalation_rules.models import (
    ACTION_NOTIFY,
    EscalationLog,
    EscalationRule,
)


class EscalationRuleFactory(DjangoModelFactory):
    """Factory for :class:`escalation_rules.models.EscalationRule`.

    Defaults: ``time_limit_hours=24``, ``action=notify``,
    ``escalate_to={}`` (resolves to None → falls back to tenant admin).
    Override ``criteria`` / ``time_limit_hours`` / ``escalate_to`` /
    ``action`` in the test to exercise the other paths.
    """

    class Meta:
        model = EscalationRule

    tenant = factory.LazyFunction(_current_tenant)
    target_model = "deal"
    criteria = factory.LazyFunction(lambda: {})
    time_limit_hours = 24
    escalate_to = factory.LazyFunction(lambda: {})
    action = ACTION_NOTIFY
    is_active = True


class EscalationLogFactory(DjangoModelFactory):
    """Factory for :class:`escalation_rules.models.EscalationLog`."""

    class Meta:
        model = EscalationLog

    tenant = factory.LazyFunction(_current_tenant)
    rule = factory.SubFactory(EscalationRuleFactory)
    record_module = "deal"
    record_id = factory.Sequence(lambda n: str(n + 1))
    escalated_to = factory.LazyFunction(_current_user)
    action_taken = ACTION_NOTIFY


__all__ = ["EscalationLogFactory", "EscalationRuleFactory"]
