"""factory_boy factories for the dashboards app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user

from .models import Dashboard, DashboardWidget, WIDGET_CHART


class DashboardFactory(DjangoModelFactory):
    """Factory for :class:`Dashboard`."""

    class Meta:
        model = Dashboard

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Dashboard {n}")
    layout = factory.LazyFunction(lambda: {"columns": 12, "rowHeight": 30, "margin": 8})
    filters = factory.LazyFunction(lambda: {})
    refresh_interval = 300
    shared_with = factory.LazyFunction(lambda: [])
    is_default = False
    created_by = factory.LazyFunction(_current_user)


class DashboardWidgetFactory(DjangoModelFactory):
    """Factory for :class:`DashboardWidget`."""

    class Meta:
        model = DashboardWidget

    tenant = factory.LazyFunction(_current_tenant)
    dashboard = factory.SubFactory(DashboardFactory)
    widget_type = WIDGET_CHART
    title = factory.Sequence(lambda n: f"Widget {n}")
    report = None
    position = factory.LazyFunction(lambda: {"x": 0, "y": 0, "w": 4, "h": 2})
    color_theme = "default"
    drill_down = None
    custom_config = factory.LazyFunction(lambda: {"data_source": "sales_funnel"})
    order = factory.Sequence(lambda n: n)


__all__ = ["DashboardFactory", "DashboardWidgetFactory"]
