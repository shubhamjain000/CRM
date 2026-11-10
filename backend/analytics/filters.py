"""django-filter FilterSets for the analytics app."""

from __future__ import annotations

import django_filters

from .models import Dashboard, DashboardWidget


class DashboardFilter(django_filters.FilterSet):
    """Filter dashboards by name / default flag / creator."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    is_default = django_filters.BooleanFilter(field_name="is_default")
    created_by = django_filters.NumberFilter(field_name="created_by_id")

    class Meta:
        model = Dashboard
        fields: list[str] = []


class DashboardWidgetFilter(django_filters.FilterSet):
    """Filter widgets by dashboard / type / report binding."""

    dashboard = django_filters.NumberFilter(field_name="dashboard_id")
    widget_type = django_filters.CharFilter(field_name="widget_type")
    report = django_filters.NumberFilter(field_name="report_id")

    class Meta:
        model = DashboardWidget
        fields: list[str] = []
