"""Model-layer tests for the dashboards app."""

from __future__ import annotations

import pytest

from dashboards.factories import DashboardFactory, DashboardWidgetFactory
from dashboards.models import Dashboard, DashboardWidget, WIDGET_KPI


pytestmark = pytest.mark.django_db


def test_dashboard_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, name="My Dashboard", created_by=user)
    assert dash.refresh_interval == 300
    assert dash.is_default is False
    assert dash.shared_with == []
    assert str(dash) == "My Dashboard"


def test_dashboard_widget_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    widget = DashboardWidgetFactory(
        tenant=active_tenant, dashboard=dash, title="KPI Tile", widget_type=WIDGET_KPI
    )
    assert widget.widget_type == "kpi"
    assert widget.order >= 0
    assert "KPI Tile" in str(widget)


def test_dashboard_cascade_deletes_widgets(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    DashboardWidgetFactory(tenant=active_tenant, dashboard=dash)
    DashboardWidgetFactory(tenant=active_tenant, dashboard=dash)
    assert DashboardWidget.objects.filter(dashboard=dash).count() == 2
    dash_pk = dash.pk
    dash.delete()
    assert DashboardWidget.objects.filter(dashboard_id=dash_pk).count() == 0
    assert Dashboard.objects.filter(pk=dash_pk).count() == 0


def test_dashboard_layout_json_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    layout = {"columns": 12, "rowHeight": 40, "float": True}
    dash = DashboardFactory(tenant=active_tenant, layout=layout, created_by=user)
    dash.refresh_from_db()
    assert dash.layout == layout
