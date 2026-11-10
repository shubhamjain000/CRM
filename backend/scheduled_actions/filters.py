"""django-filter FilterSets for the scheduled_actions app."""

from __future__ import annotations

import django_filters

from scheduled_actions.models import ScheduledJob, ScheduledJobLog


class ScheduledJobFilter(django_filters.FilterSet):
    """Filter scheduled jobs by status / action_type."""

    status = django_filters.CharFilter(field_name="status")
    action_type = django_filters.CharFilter(field_name="action_type")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = ScheduledJob
        fields: list[str] = []


class ScheduledJobLogFilter(django_filters.FilterSet):
    """Filter scheduled-job logs by job / status."""

    job = django_filters.NumberFilter(field_name="job_id")
    status = django_filters.CharFilter(field_name="status")
    started_at__gte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="gte")
    started_at__lte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="lte")

    class Meta:
        model = ScheduledJobLog
        fields: list[str] = []
