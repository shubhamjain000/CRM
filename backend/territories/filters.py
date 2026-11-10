"""django-filter FilterSets for the territories app."""

from __future__ import annotations

import django_filters

from .models import Territory, TerritoryMember


class TerritoryFilter(django_filters.FilterSet):
    """Filter territories by name / manager / parent / active."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    manager = django_filters.NumberFilter(field_name="manager_id")
    parent = django_filters.NumberFilter(field_name="parent_id")
    is_active = django_filters.BooleanFilter(field_name="is_active")

    class Meta:
        model = Territory
        fields: list[str] = []


class TerritoryMemberFilter(django_filters.FilterSet):
    """Filter territory memberships by territory / user."""

    territory = django_filters.NumberFilter(field_name="territory_id")
    user = django_filters.NumberFilter(field_name="user_id")

    class Meta:
        model = TerritoryMember
        fields: list[str] = []
