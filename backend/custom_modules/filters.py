"""django-filter FilterSets for the custom_modules app."""

from __future__ import annotations

import django_filters

from .models import CustomModule, CustomModuleField, CustomModuleRecord


class CustomModuleFilter(django_filters.FilterSet):
    """Filter custom modules by name / slug / active."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    slug = django_filters.CharFilter(field_name="slug")
    is_active = django_filters.BooleanFilter(field_name="is_active")

    class Meta:
        model = CustomModule
        fields: list[str] = []


class CustomModuleFieldFilter(django_filters.FilterSet):
    """Filter custom module fields by module / type / section / searchable."""

    module = django_filters.NumberFilter(field_name="module_id")
    field_type = django_filters.CharFilter(field_name="field_type")
    section = django_filters.CharFilter(field_name="section")
    is_searchable = django_filters.BooleanFilter(field_name="is_searchable")
    is_required = django_filters.BooleanFilter(field_name="is_required")

    class Meta:
        model = CustomModuleField
        fields: list[str] = []


class CustomModuleRecordFilter(django_filters.FilterSet):
    """Filter custom module records by module."""

    module = django_filters.NumberFilter(field_name="module_id")

    class Meta:
        model = CustomModuleRecord
        fields: list[str] = []
