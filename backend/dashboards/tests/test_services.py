"""Service-layer tests for the dashboards app."""

from __future__ import annotations

import pytest

from dashboards.factories import DashboardFactory, DashboardWidgetFactory
from dashboards.services import get_templates, render_dashboard


pytestmark = pytest.mark.django_db


def test_get_templates_returns_five():  # type: ignore[no-untyped-def]
    templates = get_templates()
    assert len(templates) == 5
    names = {t["name"] for t in templates}
    assert names == {
        "Sales Manager",
        "Sales Rep",
        "Marketing",
        "Customer Success",
        "Executive",
    }
    for tpl in templates:
        assert "widgets" in tpl and len(tpl["widgets"]) > 0
        assert "layout" in tpl


def test_get_templates_returns_deep_copy():  # type: ignore[no-untyped-def]
    a = get_templates()
    a[0]["name"] = "MUTATED"
    b = get_templates()
    assert b[0]["name"] == "Sales Manager"


def test_render_dashboard_empty_widgets(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user, name="Empty")
    rendered = render_dashboard(dash)
    assert rendered["name"] == "Empty"
    assert rendered["widgets"] == []
    assert rendered["id"] == dash.pk


def test_render_dashboard_static_widget_passes_through(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    DashboardWidgetFactory(
        tenant=active_tenant,
        dashboard=dash,
        widget_type="kpi",
        title="Static KPI",
        custom_config={"metric": "revenue", "period": "month"},
    )
    rendered = render_dashboard(dash)
    assert len(rendered["widgets"]) == 1
    w = rendered["widgets"][0]
    assert w["title"] == "Static KPI"
    assert w["config"]["metric"] == "revenue"
    # Static (no report, no data_source) → empty data block, no error key.
    assert w["data"] == {}


def test_render_dashboard_respects_widget_order(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    DashboardWidgetFactory(
        tenant=active_tenant, dashboard=dash, title="B", order=2
    )
    DashboardWidgetFactory(
        tenant=active_tenant, dashboard=dash, title="A", order=1
    )
    rendered = render_dashboard(dash)
    titles = [w["title"] for w in rendered["widgets"]]
    assert titles == ["A", "B"]
