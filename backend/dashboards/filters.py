"""django-filter FilterSets for the dashboards app."""

from __future__ import annotations

import django_filters

from .models import Dashboard, DashboardWidget


class DashboardFilter(django_filters.FilterSet):
    """Filter dashboards by name / default / creator / shared_with."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    is_default = django_filters.BooleanFilter(field_name="is_default")
    created_by = django_filters.NumberFilter(field_name="created_by_id")
    shared_with = django_filters.NumberFilter(method="_filter_shared_with")

    class Meta:
        model = Dashboard
        fields: list[str] = []

    def _filter_shared_with(self, queryset, name, value):  # type: ignore[no-untyped-def]
        # JSON list containment — match user id inside the shared_with array.
        return queryset.filter(shared_with__contains=[value])


class DashboardWidgetFilter(django_filters.FilterSet):
    """Filter widgets by dashboard / type / report."""

    dashboard = django_filters.NumberFilter(field_name="dashboard_id")
    widget_type = django_filters.CharFilter(field_name="widget_type")
    report = django_filters.NumberFilter(field_name="report_id")

    class Meta:
        model = DashboardWidget
        fields: list[str] = []
