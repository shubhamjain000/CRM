"""Model-layer tests for the reports app."""

from __future__ import annotations

import pytest

from reports.factories import (
    ReportExecutionFactory,
    ReportFactory,
    ReportFolderFactory,
    ReportSubscriptionFactory,
)
from reports.models import (
    EXEC_COMPLETED,
    Report,
    ReportExecution,
    ReportFolder,
    ReportSubscription,
)


pytestmark = pytest.mark.django_db


def test_report_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    report = ReportFactory(tenant=active_tenant, name="My Report", created_by=user)
    assert report.source_model == "lead"
    assert report.report_type == "tabular"
    assert report.is_active is True
    assert report.is_published is False
    assert report.limit == 100
    assert str(report) == "My Report"


def test_report_folder_self_reference(active_tenant, user):  # type: ignore[no-untyped-def]
    root = ReportFolderFactory(tenant=active_tenant, name="Root", parent=None, created_by=user)
    child = ReportFolderFactory(tenant=active_tenant, name="Child", parent=root, created_by=user)
    assert child.parent_id == root.pk
    assert list(root.children.all()) == [child]


def test_report_subscription_unique_per_user(active_tenant, user):  # type: ignore[no-untyped-def]
    report = ReportFactory(tenant=active_tenant, created_by=user)
    ReportSubscriptionFactory(tenant=active_tenant, report=report, user=user)
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        ReportSubscriptionFactory(tenant=active_tenant, report=report, user=user)
    assert ReportSubscription.objects.filter(report=report, user=user).count() == 1


def test_report_execution_str(active_tenant, user):  # type: ignore[no-untyped-def]
    execution = ReportExecutionFactory(
        tenant=active_tenant, executed_by=user, status=EXEC_COMPLETED
    )
    assert execution.status == "completed"
    assert str(execution).startswith(f"{execution.report_id} / completed")
