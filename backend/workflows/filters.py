"""django-filter FilterSets for the workflows app."""

from __future__ import annotations

import django_filters

from workflows.models import WorkflowExecution, WorkflowRule


class WorkflowRuleFilter(django_filters.FilterSet):
    """Filter workflow rules by trigger_type / trigger_model / active."""

    trigger_type = django_filters.CharFilter(field_name="trigger_type")
    trigger_model = django_filters.CharFilter(field_name="trigger_model")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = WorkflowRule
        fields: list[str] = []


class WorkflowExecutionFilter(django_filters.FilterSet):
    """Filter executions by rule / status / target."""

    rule = django_filters.NumberFilter(field_name="rule_id")
    status = django_filters.CharFilter(field_name="status")
    target_module = django_filters.CharFilter(field_name="target_module")
    target_id = django_filters.CharFilter(field_name="target_id")
    started_at__gte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="gte")
    started_at__lte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="lte")

    class Meta:
        model = WorkflowExecution
        fields: list[str] = []
