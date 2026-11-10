"""factory_boy factories for the reports app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from reports.models import (
    CHART_BAR,
    REPORT_TABULAR,
    SOURCE_LEAD,
    Report,
    ReportExecution,
    ReportFolder,
    ReportSubscription,
)


class ReportFolderFactory(DjangoModelFactory):
    """Factory for :class:`ReportFolder`."""

    class Meta:
        model = ReportFolder

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Folder {n}")
    parent = None
    created_by = factory.LazyFunction(_current_user)


class ReportFactory(DjangoModelFactory):
    """Factory for :class:`Report`."""

    class Meta:
        model = Report

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Report {n}")
    description = factory.Faker("sentence")
    source_model = SOURCE_LEAD
    report_type = REPORT_TABULAR
    fields = factory.LazyFunction(lambda: [{"field": "first_name", "alias": "Name"}])
    filters = factory.LazyFunction(lambda: {})
    group_by = factory.LazyFunction(lambda: [])
    order_by = factory.LazyFunction(lambda: [])
    aggregates = factory.LazyFunction(lambda: [])
    having = factory.LazyFunction(lambda: {})
    limit = 100
    offset = 0
    chart_type = CHART_BAR
    chart_config = factory.LazyFunction(lambda: {})
    schedule_cron = ""
    shared_with = factory.LazyFunction(lambda: [])
    folder = None
    is_active = True
    is_published = False
    created_by = factory.LazyFunction(_current_user)


class ReportSubscriptionFactory(DjangoModelFactory):
    """Factory for :class:`ReportSubscription`."""

    class Meta:
        model = ReportSubscription

    tenant = factory.LazyFunction(_current_tenant)
    report = factory.SubFactory(ReportFactory)
    user = factory.LazyFunction(_current_user)
    email_on_run = True


class ReportExecutionFactory(DjangoModelFactory):
    """Factory for :class:`ReportExecution`."""

    class Meta:
        model = ReportExecution

    tenant = factory.LazyFunction(_current_tenant)
    report = factory.SubFactory(ReportFactory)
    executed_by = factory.LazyFunction(_current_user)
    status = "completed"
    row_count = 5
    execution_time_ms = 42
    result_data = factory.LazyFunction(lambda: {"columns": [], "rows": []})
    error_message = ""


__all__ = [
    "ReportExecutionFactory",
    "ReportFactory",
    "ReportFolderFactory",
    "ReportSubscriptionFactory",
]
