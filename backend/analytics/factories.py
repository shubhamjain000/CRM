"""factory_boy factories for the analytics app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from analytics.models import Dashboard, DashboardWidget
from api.factories import _current_tenant, _current_user


class DashboardFactory(DjangoModelFactory):
    """Factory for :class:`Dashboard`."""

    class Meta:
        model = Dashboard

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Dashboard {n}")
    config = factory.LazyFunction(lambda: {"grid": "12-col"})
    is_default = False
    created_by = factory.LazyFunction(_current_user)


class DashboardWidgetFactory(DjangoModelFactory):
    """Factory for :class:`DashboardWidget`."""

    class Meta:
        model = DashboardWidget

    tenant = factory.LazyFunction(_current_tenant)
    dashboard = factory.SubFactory(DashboardFactory)
    title = factory.Sequence(lambda n: f"Widget {n}")
    widget_type = "chart"
    report = None
    config = factory.LazyFunction(lambda: {"data_source": "sales_funnel"})
    order = factory.Sequence(lambda n: n)


__all__ = ["DashboardFactory", "DashboardWidgetFactory"]
