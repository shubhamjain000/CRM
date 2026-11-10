"""factory_boy factories for the approvals app.

All factories use the shared ``_current_tenant`` / ``_current_user``
helpers from :mod:`api.factories` so they lazily attach the active tenant
(set via ``tenant_context`` in tests) or create one when none exists.
"""

from __future__ import annotations

from datetime import date, timedelta

import factory
from django.utils import timezone
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from approvals.models import (
    ApprovalAction,
    ApprovalDelegation,
    ApprovalProcess,
    ApprovalRequest,
    ApprovalStep,
    STATUS_PENDING,
    STEP_SEQUENTIAL,
    TARGET_MODEL_DEAL,
)


class ApprovalProcessFactory(DjangoModelFactory):
    """Factory for :class:`approvals.models.ApprovalProcess`.

    Defaults: ``target_model=deal``, ``trigger_criteria={}`` (matches
    everything), ``is_active=True``, ``version=1``.
    """

    class Meta:
        model = ApprovalProcess

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Approval Process {n}")
    description = factory.Faker("sentence")
    target_model = TARGET_MODEL_DEAL
    trigger_criteria = factory.LazyFunction(lambda: {})
    is_active = True
    version = 1


class ApprovalStepFactory(DjangoModelFactory):
    """Factory for :class:`approvals.models.ApprovalStep`.

    Defaults to a sequential step with no approvers (the service returns
    ``None`` and the rule effectively no-ops). Override ``approvers`` /
    ``step_type`` / ``time_limit_hours`` in the test to exercise the
    other resolution strategies.
    """

    class Meta:
        model = ApprovalStep

    tenant = factory.LazyFunction(_current_tenant)
    process = factory.SubFactory(ApprovalProcessFactory)
    order = factory.Sequence(lambda n: n)
    step_type = STEP_SEQUENTIAL
    approvers = factory.LazyFunction(lambda: [])
    time_limit_hours = None
    escalation_approver = factory.LazyFunction(lambda: {})
    require_comment = False


class ApprovalRequestFactory(DjangoModelFactory):
    """Factory for :class:`approvals.models.ApprovalRequest`.

    Defaults: ``status=pending``, ``target_module=deal``, ``submitted_by``
    is the current user. ``current_step`` is the first step of the
    process (created on the fly if not supplied).
    """

    class Meta:
        model = ApprovalRequest

    tenant = factory.LazyFunction(_current_tenant)
    process = factory.SubFactory(ApprovalProcessFactory)
    target_module = "deal"
    target_id = factory.Sequence(lambda n: str(n + 1))
    target_name = factory.Sequence(lambda n: f"Deal {n}")
    submitted_by = factory.LazyFunction(_current_user)
    submitted_at = factory.LazyFunction(timezone.now)
    current_step = factory.SubFactory(
        ApprovalStepFactory,
        process=factory.SelfAttribute("..process"),
    )
    status = STATUS_PENDING
    completed_at = None
    comments = factory.LazyFunction(lambda: [])


class ApprovalActionFactory(DjangoModelFactory):
    """Factory for :class:`approvals.models.ApprovalAction`."""

    class Meta:
        model = ApprovalAction

    tenant = factory.LazyFunction(_current_tenant)
    request = factory.SubFactory(ApprovalRequestFactory)
    approver = factory.LazyFunction(_current_user)
    action = "approve"
    comment = factory.Faker("sentence")
    timestamp = factory.LazyFunction(timezone.now)


class ApprovalDelegationFactory(DjangoModelFactory):
    """Factory for :class:`approvals.models.ApprovalDelegation`.

    Defaults: ``user`` is the current user, ``delegate_to`` is a fresh
    user, ``start_date``/``end_date`` span today + 7 days.
    """

    class Meta:
        model = ApprovalDelegation

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    delegate_to = factory.SubFactory("api.factories.UserFactory")
    start_date = factory.LazyFunction(date.today)
    end_date = factory.LazyFunction(lambda: date.today() + timedelta(days=7))
    is_active = True


__all__ = [
    "ApprovalActionFactory",
    "ApprovalDelegationFactory",
    "ApprovalProcessFactory",
    "ApprovalRequestFactory",
    "ApprovalStepFactory",
]
