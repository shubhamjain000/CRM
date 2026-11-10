"""Service-layer tests for the reports app."""

from __future__ import annotations

import pytest

from reports.analytics_queries import sales_funnel, source_roi
from reports.factories import ReportFactory
from reports.models import Report
from reports.services import (
    ReportService,
    build_query,
    evaluate_filter_tree,
    export_report,
    generate_chart_data,
)


pytestmark = pytest.mark.django_db


def test_evaluate_filter_tree_and_or(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415
    from leads.models import Lead  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, first_name="Anna", industry="Tech")
    LeadFactory(tenant=active_tenant, first_name="Bob", industry="Healthcare")
    LeadFactory(tenant=active_tenant, first_name="Carl", industry="Tech")

    tree = {
        "op": "and",
        "children": [
            {"field": "industry", "op": "eq", "value": "Tech"},
            {"field": "first_name", "op": "startswith", "value": "C"},
        ],
    }
    qs = evaluate_filter_tree(tree, Lead.objects.all())
    assert qs.count() == 1
    assert qs.first().first_name == "Carl"

    or_tree = {
        "op": "or",
        "children": [
            {"field": "first_name", "op": "eq", "value": "Anna"},
            {"field": "industry", "op": "eq", "value": "Healthcare"},
        ],
    }
    assert evaluate_filter_tree(or_tree, Lead.objects.all()).count() == 2


def test_build_query_group_by_aggregate(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, industry="Tech")
    LeadFactory(tenant=active_tenant, industry="Tech")
    LeadFactory(tenant=active_tenant, industry="Healthcare")

    report = ReportFactory(
        tenant=active_tenant,
        created_by=user,
        source_model="lead",
        fields=[],
        group_by=["industry"],
        aggregates=[{"function": "count", "field": "id", "alias": "count"}],
        order_by=[{"field": "industry", "dir": "asc"}],
    )
    rows = list(build_query(report))
    industries = sorted(r["industry"] for r in rows)
    assert industries == ["Healthcare", "Tech"]
    counts = {r["industry"]: r["count"] for r in rows}
    assert counts == {"Tech": 2, "Healthcare": 1}


def test_execute_report_returns_expected_shape(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, first_name="Zoe", industry="Tech")
    report = ReportFactory(
        tenant=active_tenant,
        created_by=user,
        source_model="lead",
        fields=[{"field": "first_name", "alias": "Name"}],
        group_by=[],
        aggregates=[],
        order_by=[],
        chart_type="none",
        limit=10,
    )
    result = ReportService().execute_report(report, user=user, persist=False)
    assert "columns" in result
    assert "rows" in result
    assert "total" in result
    assert "chart_data" in result
    assert result["total"] == 1
    assert result["chart_data"] == {}  # chart_type=none


def test_generate_chart_data_pie_and_funnel(active_tenant, user):  # type: ignore[no-untyped-def]
    from reports.models import CHART_FUNNEL, CHART_PIE  # noqa: PLC0415

    rows = [
        {"label": "A", "value": 10},
        {"label": "B", "value": 30},
        {"label": "C", "value": 60},
    ]
    pie_report = ReportFactory(
        tenant=active_tenant, created_by=user, chart_type=CHART_PIE,
        chart_config={"label_field": "label", "value_field": "value"},
    )
    pie = generate_chart_data(pie_report, rows)
    assert pie["labels"] == ["A", "B", "C"]
    assert pie["data"] == [10, 30, 60]

    funnel_report = ReportFactory(
        tenant=active_tenant, created_by=user, chart_type=CHART_FUNNEL,
        chart_config={"label_field": "label", "value_field": "value"},
    )
    funnel = generate_chart_data(funnel_report, rows)
    assert funnel["stages"] == ["A", "B", "C"]
    assert funnel["values"] == [10, 30, 60]


def test_export_report_csv_and_json(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, first_name="Anna", industry="Tech")
    report = ReportFactory(
        tenant=active_tenant,
        created_by=user,
        source_model="lead",
        fields=[{"field": "first_name", "alias": "Name"}],
        group_by=[],
        aggregates=[],
        order_by=[],
        chart_type="none",
        limit=10,
    )
    csv_bytes = export_report(report, fmt="csv")
    assert csv_bytes.startswith(b"Name")
    json_bytes = export_report(report, fmt="json")
    assert b'"rows"' in json_bytes


def test_analytics_sales_funnel_returns_expected_keys(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.factories import LeadFactory  # noqa: PLC0415

    LeadFactory(tenant=active_tenant, is_converted=True)
    LeadFactory(tenant=active_tenant, is_converted=False)
    result = sales_funnel(active_tenant)
    assert "stages" in result
    assert "conversions" in result
    assert "overall" in result
    assert result["stages"][0][0] == "Leads"
    assert result["stages"][0][1] >= 2


def test_analytics_source_roi_returns_rows(active_tenant, user):  # type: ignore[no-untyped-def]
    from deals.factories import DealFactory  # noqa: PLC0415
    from deals.models_pipeline import Pipeline, Stage  # noqa: PLC0415

    pipeline = Pipeline.objects.create(tenant=active_tenant, name="P")
    won_stage = Stage.objects.create(
        tenant=active_tenant, pipeline=pipeline, name="Won", is_won_stage=True,
        forecast_category="closed", probability=100.0,
    )
    DealFactory(
        tenant=active_tenant, pipeline=pipeline, stage=won_stage,
        lead_source="web", amount=1000, owner=user,
    )
    DealFactory(
        tenant=active_tenant, pipeline=pipeline, stage=won_stage,
        lead_source="referral", amount=5000, owner=user,
    )
    result = source_roi(active_tenant)
    assert len(result["rows"]) >= 2
    assert all("revenue" in r for r in result["rows"])
