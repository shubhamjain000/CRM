"""factory_boy factories for the scheduled_actions app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant
from scheduled_actions.models import (
    LOG_STATUS_SUCCESS,
    ScheduledJob,
    ScheduledJobLog,
)


class ScheduledJobFactory(DjangoModelFactory):
    """Factory for :class:`ScheduledJob`.

    Defaults: ``cron_expression="* * * * *"`` (every minute),
    ``action_type="notify_team"``, ``status="active"``.
    """

    class Meta:
        model = ScheduledJob

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Scheduled Job {n}")
    cron_expression = "* * * * *"
    action_type = "notify_team"
    config = factory.LazyFunction(lambda: {"title": "Scheduled", "body": "Run"})
    status = "active"
    timezone = "UTC"


class ScheduledJobLogFactory(DjangoModelFactory):
    """Factory for :class:`ScheduledJobLog`."""

    class Meta:
        model = ScheduledJobLog

    tenant = factory.LazyFunction(_current_tenant)
    job = factory.SubFactory(ScheduledJobFactory)
    status = LOG_STATUS_SUCCESS
    result = factory.LazyFunction(lambda: {})


__all__ = ["ScheduledJobFactory", "ScheduledJobLogFactory"]
