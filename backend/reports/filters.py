"""django-filter FilterSets for the reports app."""

from __future__ import annotations

import django_filters

from .models import Report, ReportExecution, ReportFolder, ReportSubscription


class ReportFilter(django_filters.FilterSet):
    """Filter reports by source / type / chart / folder / active / published."""

    source_model = django_filters.CharFilter(field_name="source_model")
    report_type = django_filters.CharFilter(field_name="report_type")
    chart_type = django_filters.CharFilter(field_name="chart_type")
    folder = django_filters.NumberFilter(field_name="folder_id")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    is_published = django_filters.BooleanFilter(field_name="is_published")
    created_by = django_filters.NumberFilter(field_name="created_by_id")
    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")

    class Meta:
        model = Report
        fields: list[str] = []


class ReportFolderFilter(django_filters.FilterSet):
    """Filter folders by name / parent."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    parent = django_filters.NumberFilter(field_name="parent_id")
    is_root = django_filters.BooleanFilter(method="_filter_is_root")

    class Meta:
        model = ReportFolder
        fields: list[str] = []

    def _filter_is_root(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if value:
            return queryset.filter(parent__isnull=True)
        return queryset.filter(parent__isnull=False)


class ReportSubscriptionFilter(django_filters.FilterSet):
    """Filter subscriptions by report / user."""

    report = django_filters.NumberFilter(field_name="report_id")
    user = django_filters.NumberFilter(field_name="user_id")
    email_on_run = django_filters.BooleanFilter(field_name="email_on_run")

    class Meta:
        model = ReportSubscription
        fields: list[str] = []


class ReportExecutionFilter(django_filters.FilterSet):
    """Filter executions by report / status / date range."""

    report = django_filters.NumberFilter(field_name="report_id")
    status = django_filters.CharFilter(field_name="status")
    started_at__gte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="gte")
    started_at__lte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="lte")

    class Meta:
        model = ReportExecution
        fields: list[str] = []
