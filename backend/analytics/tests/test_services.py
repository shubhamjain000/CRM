"""Service-layer tests for the analytics app."""

from __future__ import annotations

import pytest

from analytics.factories import DashboardFactory, DashboardWidgetFactory
from analytics.services import compute, list_available, render_dashboard
from reports.factories import ReportFactory


pytestmark = pytest.mark.django_db


def test_list_available_includes_all_prebuilts(active_tenant, user):  # type: ignore[no-untyped-def]
    sources = list_available()
    assert "sales_funnel" in sources
    assert "cohort_retention" in sources
    assert len(sources) == 12


def test_compute_dispatches_to_analytics_queries(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, is_converted=True)
    LeadFactory(tenant=active_tenant, is_converted=False)
    result = compute("sales_funnel", tenant=active_tenant)
    assert "stages" in result
    assert result["stages"][0][0] == "Leads"


def test_compute_unknown_source_raises(active_tenant, user):  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError):
        compute("does_not_exist", tenant=active_tenant)


def test_render_dashboard_hydrates_widgets(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, is_converted=True)
    dash = DashboardFactory(tenant=active_tenant, name="D", created_by=user)
    DashboardWidgetFactory(
        tenant=active_tenant,
        dashboard=dash,
        title="Funnel",
        widget_type="funnel",
        config={"data_source": "sales_funnel"},
        order=0,
    )
    result = render_dashboard(dash.pk)
    assert result["name"] == "D"
    assert len(result["widgets"]) == 1
    widget = result["widgets"][0]
    assert widget["title"] == "Funnel"
    assert "stages" in widget["data"]


def test_render_dashboard_with_report_widget(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, first_name="Anna")
    report = ReportFactory(
        tenant=active_tenant,
        created_by=user,
        source_model="lead",
        fields=[{"field": "first_name", "alias": "Name"}],
        chart_type="none",
        limit=10,
    )
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    DashboardWidgetFactory(
        tenant=active_tenant,
        dashboard=dash,
        title="Leads",
        widget_type="table",
        report=report,
        config={},
        order=0,
    )
    result = render_dashboard(dash.pk)
    widget = result["widgets"][0]
    assert "columns" in widget["data"]
    assert widget["data"]["total"] >= 1
