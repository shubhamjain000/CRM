"""Model-layer tests for the analytics app."""

from __future__ import annotations

import pytest

from analytics.factories import DashboardFactory, DashboardWidgetFactory
from analytics.models import Dashboard, DashboardWidget


pytestmark = pytest.mark.django_db


def test_dashboard_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, name="Sales", created_by=user)
    assert dash.is_default is False
    assert str(dash) == "Sales"
    assert dash.config == {"grid": "12-col"}


def test_widget_factory_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    widget = DashboardWidgetFactory(tenant=active_tenant, dashboard=dash)
    assert widget.widget_type == "chart"
    assert widget.config.get("data_source") == "sales_funnel"
    assert DashboardWidget.objects.filter(dashboard=dash).count() == 1


def test_widget_ordering(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    w3 = DashboardWidgetFactory(tenant=active_tenant, dashboard=dash, order=3)
    w1 = DashboardWidgetFactory(tenant=active_tenant, dashboard=dash, order=1)
    w2 = DashboardWidgetFactory(tenant=active_tenant, dashboard=dash, order=2)
    ordered = list(DashboardWidget.objects.filter(dashboard=dash).order_by("order", "id"))
    assert ordered == [w1, w2, w3]


def test_dashboard_cascade_delete_widgets(active_tenant, user):  # type: ignore[no-untyped-def]
    dash = DashboardFactory(tenant=active_tenant, created_by=user)
    DashboardWidgetFactory(tenant=active_tenant, dashboard=dash)
    DashboardWidgetFactory(tenant=active_tenant, dashboard=dash)
    assert DashboardWidget.objects.filter(dashboard=dash).count() == 2
    dash.delete()
    assert DashboardWidget.objects.filter(dashboard=dash).count() == 0
