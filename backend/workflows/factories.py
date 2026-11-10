"""factory_boy factories for the workflows app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from workflows.models import (
    ACTION_NOTIFY_TEAM,
    ACTION_SEND_EMAIL,
    TRIGGER_RECORD_CREATE,
    WorkflowAction,
    WorkflowExecution,
    WorkflowRule,
)


class WorkflowRuleFactory(DjangoModelFactory):
    """Factory for :class:`WorkflowRule`.

    Defaults: ``trigger_type=record_create``, ``trigger_model=lead``,
    ``trigger_conditions={}`` (matches every record), ``is_active=True``.
    """

    class Meta:
        model = WorkflowRule

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Workflow Rule {n}")
    trigger_type = TRIGGER_RECORD_CREATE
    trigger_model = "lead"
    trigger_conditions = factory.LazyFunction(lambda: {})
    is_active = True
    version = 1
    created_by = factory.LazyFunction(_current_user)


class WorkflowActionFactory(DjangoModelFactory):
    """Factory for :class:`WorkflowAction`."""

    class Meta:
        model = WorkflowAction

    tenant = factory.LazyFunction(_current_tenant)
    rule = factory.SubFactory(WorkflowRuleFactory)
    order = factory.Sequence(lambda n: n)
    action_type = ACTION_SEND_EMAIL
    config = factory.LazyFunction(lambda: {"subject": "Hi", "body": "Hello"})


class WorkflowExecutionFactory(DjangoModelFactory):
    """Factory for :class:`WorkflowExecution`."""

    class Meta:
        model = WorkflowExecution

    tenant = factory.LazyFunction(_current_tenant)
    rule = factory.SubFactory(WorkflowRuleFactory)
    target_module = "lead"
    target_id = factory.Sequence(lambda n: str(n + 1))
    status = "completed"
    actions_executed = factory.LazyFunction(lambda: [])


__all__ = ["WorkflowActionFactory", "WorkflowExecutionFactory", "WorkflowRuleFactory"]
