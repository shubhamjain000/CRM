"""django-filter FilterSets for the layouts app."""

from __future__ import annotations

import django_filters

from .models import Layout, LayoutSection


class LayoutFilter(django_filters.FilterSet):
    """Filter layouts by module / profile / default."""

    module = django_filters.CharFilter(field_name="module")
    profile = django_filters.NumberFilter(field_name="profile_id")
    is_default = django_filters.BooleanFilter(field_name="is_default")

    class Meta:
        model = Layout
        fields: list[str] = []


class LayoutSectionFilter(django_filters.FilterSet):
    """Filter layout sections by layout."""

    layout = django_filters.NumberFilter(field_name="layout_id")

    class Meta:
        model = LayoutSection
        fields: list[str] = []
