"""django-filter FilterSets for the blueprint app."""

from __future__ import annotations

import django_filters

from blueprint.models import Blueprint, BlueprintExecution


class BlueprintFilter(django_filters.FilterSet):
    """Filter blueprints by pipeline / active / published."""

    pipeline = django_filters.NumberFilter(field_name="pipeline_id")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    is_published = django_filters.BooleanFilter(field_name="is_published")
    name = django_filters.CharFilter(lookup_expr="icontains")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Blueprint
        fields: list[str] = []


class BlueprintExecutionFilter(django_filters.FilterSet):
    """Filter executions by deal / pipeline / owner / completion / stuck."""

    deal = django_filters.NumberFilter(field_name="deal_id")
    pipeline = django_filters.NumberFilter(field_name="blueprint__pipeline_id")
    blueprint = django_filters.NumberFilter(field_name="blueprint_id")
    owner = django_filters.NumberFilter(field_name="deal__owner_id")
    is_complete = django_filters.BooleanFilter(field_name="is_complete")
    current_state = django_filters.NumberFilter(field_name="current_state_id")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    entered_state_at__gte = django_filters.DateTimeFilter(
        field_name="entered_state_at", lookup_expr="gte"
    )
    entered_state_at__lte = django_filters.DateTimeFilter(
        field_name="entered_state_at", lookup_expr="lte"
    )

    class Meta:
        model = BlueprintExecution
        fields: list[str] = []
