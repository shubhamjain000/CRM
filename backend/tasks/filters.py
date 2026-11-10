"""django-filter FilterSets for the tasks app."""

from __future__ import annotations

import django_filters

from tasks.models import Task


class TaskFilter(django_filters.FilterSet):
    """Filter tasks by assignee / status / priority / due-date range / tag."""

    assignee = django_filters.NumberFilter(field_name="assignee_id")
    assignee_in = django_filters.BaseInFilter(field_name="assignee_id", lookup_expr="in")
    owner = django_filters.NumberFilter(field_name="owner_id")
    owner_in = django_filters.BaseInFilter(field_name="owner_id", lookup_expr="in")
    status = django_filters.CharFilter(lookup_expr="exact")
    status_in = django_filters.BaseInFilter(field_name="status", lookup_expr="in")
    priority = django_filters.CharFilter(lookup_expr="exact")
    priority_in = django_filters.BaseInFilter(field_name="priority", lookup_expr="in")
    related_module = django_filters.CharFilter(lookup_expr="exact")
    related_id = django_filters.CharFilter(lookup_expr="exact")
    parent_task = django_filters.NumberFilter(field_name="parent_task_id")
    parent_task__isnull = django_filters.BooleanFilter(
        field_name="parent_task_id", lookup_expr="isnull"
    )
    due_date__gte = django_filters.DateTimeFilter(field_name="due_date", lookup_expr="gte")
    due_date__lte = django_filters.DateTimeFilter(field_name="due_date", lookup_expr="lte")
    due_date__isnull = django_filters.BooleanFilter(field_name="due_date", lookup_expr="isnull")
    reminder__gte = django_filters.DateTimeFilter(field_name="reminder", lookup_expr="gte")
    reminder__lte = django_filters.DateTimeFilter(field_name="reminder", lookup_expr="lte")
    has_recurrence = django_filters.BooleanFilter(method="filter_has_recurrence")
    tag = django_filters.CharFilter(method="filter_tag", help_text="Exact (case-insensitive) tag match.")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    completed_at__isnull = django_filters.BooleanFilter(
        field_name="completed_at", lookup_expr="isnull"
    )

    class Meta:
        model = Task
        fields: list[str] = []

    # ------------------------------------------------------------------ methods

    def filter_has_recurrence(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if value:
            return queryset.exclude(recurrence="")
        return queryset.filter(recurrence="")

    def filter_tag(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if not value:
            return queryset
        # JSON containment on a text[]-like list is case-sensitive in Postgres;
        # we filter in Python-y SQL with __contains for a single string.
        return queryset.filter(tags__contains=[value.lower()])
