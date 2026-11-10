"""django-filter FilterSets for the escalation_rules app."""

from __future__ import annotations

import django_filters

from escalation_rules.models import EscalationLog, EscalationRule


class EscalationRuleFilter(django_filters.FilterSet):
    """Filter escalation rules by target_model / action / active."""

    target_model = django_filters.CharFilter(field_name="target_model")
    action = django_filters.CharFilter(field_name="action")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = EscalationRule
        fields: list[str] = []


class EscalationLogFilter(django_filters.FilterSet):
    """Filter escalation logs by record / rule / escalated_to / action."""

    record_module = django_filters.CharFilter(field_name="record_module")
    record_id = django_filters.CharFilter(field_name="record_id")
    rule = django_filters.NumberFilter(field_name="rule_id")
    escalated_to = django_filters.NumberFilter(field_name="escalated_to_id")
    action_taken = django_filters.CharFilter(field_name="action_taken")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = EscalationLog
        fields: list[str] = []
