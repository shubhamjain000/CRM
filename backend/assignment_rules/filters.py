"""django-filter FilterSets for the assignment_rules app."""

from __future__ import annotations

import django_filters

from assignment_rules.models import AssignmentHistory, AssignmentRule


class AssignmentRuleFilter(django_filters.FilterSet):
    """Filter assignment rules by target_model / strategy / active."""

    target_model = django_filters.CharFilter(field_name="target_model")
    strategy = django_filters.CharFilter(field_name="strategy")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = AssignmentRule
        fields: list[str] = []


class AssignmentHistoryFilter(django_filters.FilterSet):
    """Filter assignment history by record / rule / assigned_to."""

    record_module = django_filters.CharFilter(field_name="record_module")
    record_id = django_filters.CharFilter(field_name="record_id")
    rule = django_filters.NumberFilter(field_name="rule_id")
    assigned_to = django_filters.NumberFilter(field_name="assigned_to_id")
    assigned_at__gte = django_filters.DateTimeFilter(
        field_name="assigned_at", lookup_expr="gte"
    )
    assigned_at__lte = django_filters.DateTimeFilter(
        field_name="assigned_at", lookup_expr="lte"
    )

    class Meta:
        model = AssignmentHistory
        fields: list[str] = []
