"""django-filter FilterSets for the validation_rules app."""

from __future__ import annotations

import django_filters

from validation_rules.models import ValidationRule


class ValidationRuleFilter(django_filters.FilterSet):
    """Filter validation rules by target_model / field_name / condition_type / active."""

    target_model = django_filters.CharFilter(field_name="target_model")
    field_name = django_filters.CharFilter(field_name="field_name", lookup_expr="iexact")
    condition_type = django_filters.CharFilter(field_name="condition_type")
    error_severity = django_filters.CharFilter(field_name="error_severity")
    trigger_on = django_filters.CharFilter(field_name="trigger_on")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = ValidationRule
        fields: list[str] = []
